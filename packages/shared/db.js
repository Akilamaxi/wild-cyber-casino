const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Determine if we should use PostgreSQL based on environment variables
const usePostgres = !!(process.env.PGHOST || process.env.PGUSER || process.env.DATABASE_URL);

let pgPool = null;
let sqliteDb = null;

const dbPath = path.join(__dirname, 'database.sqlite');

if (usePostgres) {
  console.log('[DB] Connecting to PostgreSQL...');
  const poolConfig = process.env.DATABASE_URL 
    ? { connectionString: process.env.DATABASE_URL }
    : {
        host: process.env.PGHOST || 'localhost',
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || 'postgres',
        database: process.env.PGDATABASE || 'cyber_casino',
        port: parseInt(process.env.PGPORT || '5432', 10),
      };
  pgPool = new Pool(poolConfig);
} else {
  console.log('[DB] Connecting to SQLite...');
  sqliteDb = new sqlite3.Database(dbPath);
}

// Dialect translation layer: Converts SQLite SQL to PostgreSQL
const translateQuery = (sql) => {
  if (!usePostgres) return sql;

  let pgSql = sql;

  // 1. Replace SQLite specific inserts
  pgSql = pgSql.replace(/INSERT OR IGNORE INTO/gi, 'INSERT INTO');
  const hasOrIgnore = /INSERT OR IGNORE/i.test(sql);
  
  if (/INSERT OR REPLACE INTO game_settings/gi.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT OR REPLACE INTO game_settings/gi, 'INSERT INTO game_settings') 
      + ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  } else if (/INSERT OR REPLACE INTO slots_config/gi.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT OR REPLACE INTO slots_config/gi, 'INSERT INTO slots_config') 
      + ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  } else if (/INSERT OR REPLACE INTO dice_config/gi.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT OR REPLACE INTO dice_config/gi, 'INSERT INTO dice_config') 
      + ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  } else if (/INSERT OR REPLACE INTO crash_config/gi.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT OR REPLACE INTO crash_config/gi, 'INSERT INTO crash_config') 
      + ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value';
  } else if (/INSERT OR REPLACE INTO/gi.test(pgSql)) {
    pgSql = pgSql.replace(/INSERT OR REPLACE INTO/gi, 'INSERT INTO');
  }

  if (hasOrIgnore && !/ON CONFLICT/i.test(pgSql)) {
    pgSql += ' ON CONFLICT DO NOTHING';
  }

  // 2. Convert SQLite parameters "?" to PostgreSQL "$1", "$2", ...
  let index = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${index++}`);

  // 3. Convert double quotes around values to single quotes
  pgSql = pgSql.replace(/"LOTTERY_WINOUT"/g, "'LOTTERY_WINOUT'");
  pgSql = pgSql.replace(/"LOCKED"/g, "'LOCKED'");
  pgSql = pgSql.replace(/"FLIGHT"/g, "'FLIGHT'");
  pgSql = pgSql.replace(/"CRASHED"/g, "'CRASHED'");
  pgSql = pgSql.replace(/"LOST"/g, "'LOST'");
  pgSql = pgSql.replace(/"kill_switch_active"/g, "'kill_switch_active'");

  return pgSql;
};

// Promisified database actions
const run = (sql, params = []) => {
  if (usePostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        let pgSql = translateQuery(sql);

        // Auto-returning IDs for autoincrement compatibility
        const isInsert = /^INSERT/i.test(pgSql);
        const targetsAutoincrement = /lottery_draws|lottery_tickets|lottery_ticket_pool|spin_wheel_prizes|dice_tournaments|crash_games|crash_bets|plinko_drops/i.test(pgSql);
        if (isInsert && targetsAutoincrement && !/RETURNING/i.test(pgSql)) {
          pgSql += ' RETURNING id';
        }

        const res = await pgPool.query(pgSql, params);
        const lastID = res.rows[0]?.id || null;
        resolve({ lastID, changes: res.rowCount });
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });
  }
};

const get = (sql, params = []) => {
  if (usePostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        const pgSql = translateQuery(sql);
        const res = await pgPool.query(pgSql, params);
        resolve(res.rows[0]);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
      });
    });
  }
};

const all = (sql, params = []) => {
  if (usePostgres) {
    return new Promise(async (resolve, reject) => {
      try {
        const pgSql = translateQuery(sql);
        const res = await pgPool.query(pgSql, params);
        resolve(res.rows);
      } catch (err) {
        reject(err);
      }
    });
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      });
    });
  }
};

// ACID transaction executor
const executeTransaction = async (operationsCallback) => {
  if (usePostgres) {
    const client = await pgPool.connect();
    try {
      await client.query('BEGIN');
      
      const clientRun = (sql, params = []) => {
        let pgSql = translateQuery(sql);
        const isInsert = /^INSERT/i.test(pgSql);
        const targetsAutoincrement = /lottery_draws|lottery_tickets|lottery_ticket_pool|spin_wheel_prizes|dice_tournaments|crash_games|crash_bets|plinko_drops/i.test(pgSql);
        if (isInsert && targetsAutoincrement && !/RETURNING/i.test(pgSql)) {
          pgSql += ' RETURNING id';
        }
        return client.query(pgSql, params).then(res => ({
          lastID: res.rows[0]?.id || null,
          changes: res.rowCount
        }));
      };
      
      const clientGet = (sql, params = []) => client.query(translateQuery(sql), params).then(res => res.rows[0]);
      const clientAll = (sql, params = []) => client.query(translateQuery(sql), params).then(res => res.rows);

      const result = await operationsCallback({ run: clientRun, get: clientGet, all: clientAll });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  } else {
    await run('BEGIN IMMEDIATE TRANSACTION');
    try {
      const result = await operationsCallback({ run, get, all });
      await run('COMMIT');
      return result;
    } catch (error) {
      try {
        await run('ROLLBACK');
      } catch (rollbackErr) {
        console.error('Rollback failed:', rollbackErr);
      }
      throw error;
    }
  }
};

// Initialize Table Schemas
const initDatabase = async () => {
  if (usePostgres) {
    console.log('[DB] Running PostgreSQL schema migrations...');
    
    // 1. Users
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        email VARCHAR(255) PRIMARY KEY,
        username VARCHAR(255) NOT NULL,
        password VARCHAR(255) NOT NULL,
        balance DOUBLE PRECISION DEFAULT 1000.0,
        gamesPlayed INTEGER DEFAULT 0,
        totalWon DOUBLE PRECISION DEFAULT 0.0,
        role VARCHAR(50) DEFAULT 'USER'
      )
    `);

    // Gamification Profiles
    await run(`
      CREATE TABLE IF NOT EXISTS loyalty_profiles (
        email VARCHAR(255) PRIMARY KEY,
        points INTEGER DEFAULT 0,
        tier VARCHAR(50) DEFAULT 'BRONZE',
        FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    // 2. Transactions
    await run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id VARCHAR(255) PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        type VARCHAR(100) NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        balanceAfter DOUBLE PRECISION NOT NULL,
        timestamp VARCHAR(100) NOT NULL
      )
    `);

    // 3. Lottery Draws
    await run(`
      CREATE TABLE IF NOT EXISTS lottery_draws (
        id SERIAL PRIMARY KEY,
        lotteryName VARCHAR(255) NOT NULL,
        state VARCHAR(50) NOT NULL,
        winningNumbers TEXT,
        timestamp VARCHAR(100) NOT NULL
      )
    `);

    // 4. Lottery Tickets
    await run(`
      CREATE TABLE IF NOT EXISTS lottery_tickets (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        lotteryName VARCHAR(255) NOT NULL,
        drawId INTEGER NOT NULL,
        chosenNumbers TEXT NOT NULL,
        betAmount DOUBLE PRECISION NOT NULL,
        claimed INTEGER DEFAULT 0,
        payout DOUBLE PRECISION DEFAULT 0.0,
        timestamp VARCHAR(100) NOT NULL,
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id) ON DELETE CASCADE
      )
    `);

    // 4.1. Pre-generated ticket pool for reservation model
    await run(`
      CREATE TABLE IF NOT EXISTS lottery_ticket_pool (
        id SERIAL PRIMARY KEY,
        lotteryName VARCHAR(255) NOT NULL,
        drawId INTEGER NOT NULL,
        chosenNumbers TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'AVAILABLE',
        reservedBy VARCHAR(255),
        reservedUntil VARCHAR(100),
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id) ON DELETE CASCADE
      )
    `);

    // 5. RNG Audit Trail Logs
    await run(`
      CREATE TABLE IF NOT EXISTS audit_rng_logs (
        drawId INTEGER UNIQUE,
        lotteryName VARCHAR(255) NOT NULL,
        seed TEXT NOT NULL,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        winningNumbers TEXT NOT NULL,
        timestamp VARCHAR(100) NOT NULL,
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id) ON DELETE CASCADE
      )
    `);

    // 6. Game Settings
    await run(`
      CREATE TABLE IF NOT EXISTS game_settings (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    // 7. Dynamic Games Configuration
    await run(`
      CREATE TABLE IF NOT EXISTS games_config (
        id VARCHAR(255) PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        draw_interval_ms INTEGER NOT NULL,
        ticket_price DOUBLE PRECISION NOT NULL,
        max_tickets_per_user INTEGER DEFAULT 100,
        house_edge_percentage DOUBLE PRECISION DEFAULT 0.30,
        status VARCHAR(50) DEFAULT 'ACTIVE'
      )
    `);

    // Seed default Settings
    await run(`
      INSERT INTO game_settings (key, value) VALUES ('kill_switch_active', 'false') ON CONFLICT DO NOTHING
    `);

    // Seed default Games configurations
    const defaultGames = [
      { id: 'GAME-1', name: 'Sugar Rush 15', interval: 15000, price: 5.0 },
      { id: 'GAME-2', name: 'Sweet Treat 30', interval: 30000, price: 10.0 },
      { id: 'GAME-3', name: 'Glazed Gold', interval: 60000, price: 20.0 },
      { id: 'GAME-4', name: 'The Daily Dollop', interval: 120000, price: 50.0 },
      { id: 'GAME-5', name: 'The Weekly Whiff', interval: 300000, price: 100.0 },
      { id: 'GAME-6', name: 'The Grand Ganache', interval: 600000, price: 250.0 },
      { id: 'GAME-7', name: 'The Quarterly Banquet', interval: 900000, price: 500.0 }
    ];

    for (const g of defaultGames) {
      await run(`
        INSERT INTO games_config (id, name, draw_interval_ms, ticket_price, house_edge_percentage, status)
        VALUES ($1, $2, $3, $4, 0.30, 'ACTIVE') ON CONFLICT DO NOTHING
      `, [g.id, g.name, g.interval, g.price]);
    }

    // Seed default Demo user and Admin
    await run(`
      INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
      VALUES ('demo@casino.com', 'DemoPlayer', 'password123', 1000.0, 0, 0.0, 'USER') ON CONFLICT DO NOTHING
    `);
    
    await run(`
      INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
      VALUES ('admin@casino.com', 'SuperAdmin', 'admin123', 99999.0, 0, 0.0, 'ADMIN') ON CONFLICT DO NOTHING
    `);

    // 8. Spin Wheel Configuration
    await run(`
      CREATE TABLE IF NOT EXISTS spin_wheel_prizes (
        id SERIAL PRIMARY KEY,
        text VARCHAR(255) NOT NULL,
        color VARCHAR(50) NOT NULL,
        textColor VARCHAR(50) NOT NULL,
        mult DOUBLE PRECISION NOT NULL,
        isBonus INTEGER DEFAULT 0
      )
    `);

    const prizesCount = await get('SELECT COUNT(*) as count FROM spin_wheel_prizes');
    if (parseInt(prizesCount.count, 10) === 0) {
      const defaultPrizes = [
        { text: '10% CASHBACK', color: '#ff0055', textColor: '#ffffff', mult: 0.1, isBonus: 1 },
        { text: 'TRY AGAIN', color: '#111122', textColor: '#ffffff', mult: 0.0, isBonus: 0 },
        { text: 'FREE $10', color: '#00ffcc', textColor: '#000000', mult: 1.0, isBonus: 0 },
        { text: 'NO LUCK', color: '#1a1a30', textColor: '#ffffff', mult: 0.0, isBonus: 0 },
        { text: 'JACKPOT x5', color: '#ffcc00', textColor: '#000000', mult: 5.0, isBonus: 0 },
        { text: '20% BONUS', color: '#b500ff', textColor: '#ffffff', mult: 0.2, isBonus: 1 }
      ];

      for (const p of defaultPrizes) {
        await run(`
          INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus)
          VALUES ($1, $2, $3, $4, $5)
        `, [p.text, p.color, p.textColor, p.mult, p.isBonus]);
      }
    }

    // 9. Slots Configuration Settings
    await run(`
      CREATE TABLE IF NOT EXISTS slots_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const slotsCfgCount = await get('SELECT COUNT(*) as count FROM slots_config');
    if (parseInt(slotsCfgCount.count, 10) === 0) {
      const defaultSlotsConfigs = [
        { key: 'payout_strategy', value: 'FAIR_RNG' },
        { key: 'target_rtp', value: '0.90' },
        { key: 'symbols_config', value: JSON.stringify([
          { name: 'BAR', multiplier: 3, weight: 30, color: '#ff0055' },
          { name: 'CHERRY', multiplier: 5, weight: 25, color: '#ffcc00' },
          { name: 'BELL', multiplier: 10, weight: 20, color: '#00ffcc' },
          { name: 'DIAMOND', multiplier: 20, weight: 15, color: '#b500ff' },
          { name: 'SEVEN', multiplier: 50, weight: 8, color: '#00ff66' },
          { name: 'WILD', multiplier: 100, weight: 2, color: '#ffffff' }
        ])}
      ];

      for (const cfg of defaultSlotsConfigs) {
        await run(`
          INSERT INTO slots_config (key, value) VALUES ($1, $2)
        `, [cfg.key, cfg.value]);
      }
    }

    // 10. Dice Tournaments Configuration
    await run(`
      CREATE TABLE IF NOT EXISTS dice_tournaments (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        entry_fee DOUBLE PRECISION NOT NULL,
        prize_pool DOUBLE PRECISION NOT NULL,
        status VARCHAR(50) DEFAULT 'ACTIVE',
        created_at VARCHAR(100) NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS dice_tournament_participants (
        tournament_id INTEGER,
        email VARCHAR(255),
        rolls_left INTEGER DEFAULT 10,
        total_score INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        PRIMARY KEY (tournament_id, email)
      )
    `);

    const tourneyCount = await get('SELECT COUNT(*) as count FROM dice_tournaments');
    if (parseInt(tourneyCount.count, 10) === 0) {
      await run(`
        INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at)
        VALUES ($1, $2, $3, $4, $5)
      `, ['🎰 NEON SHIELD DICE CLASH', 10.0, 100.0, 'ACTIVE', new Date().toISOString()]);
    }

    // 11. Dice Configuration Settings
    await run(`
      CREATE TABLE IF NOT EXISTS dice_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const diceCfgCount = await get('SELECT COUNT(*) as count FROM dice_config');
    if (parseInt(diceCfgCount.count, 10) === 0) {
      const defaultDiceConfigs = [
        { key: 'mult_under_7', value: '2.3' },
        { key: 'mult_exact_7', value: '5.8' },
        { key: 'mult_over_7', value: '2.3' },
        { key: 'mult_doubles', value: '5.8' }
      ];
      for (const cfg of defaultDiceConfigs) {
        await run(`
          INSERT INTO dice_config (key, value) VALUES ($1, $2)
        `, [cfg.key, cfg.value]);
      }
    }

    // 12. Crash Configuration Settings
    await run(`
      CREATE TABLE IF NOT EXISTS crash_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const crashCfgCount = await get('SELECT COUNT(*) as count FROM crash_config');
    if (parseInt(crashCfgCount.count, 10) === 0) {
      const defaultCrashConfigs = [
        { key: 'lobby_time_ms', value: '5000' },
        { key: 'house_edge', value: '0.01' },
        { key: 'min_bet', value: '1' },
        { key: 'max_bet', value: '1000' },
        { key: 'max_multiplier', value: '10000' },
        { key: 'crash_delay_ms', value: '3000' }
      ];
      for (const cfg of defaultCrashConfigs) {
        await run(`
          INSERT INTO crash_config (key, value) VALUES ($1, $2)
        `, [cfg.key, cfg.value]);
      }
    }

    // 12b. Plinko Configuration Settings
    await run(`
      CREATE TABLE IF NOT EXISTS plinko_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const plinkoCfgCount = await get('SELECT COUNT(*) as count FROM plinko_config');
    if (parseInt(plinkoCfgCount.count, 10) === 0) {
      const defaultPlinkoConfigs = [
        { key: 'house_edge', value: '0.05' },
        { key: 'min_bet', value: '1' },
        { key: 'max_bet', value: '1000' },
        { key: 'rtp_bias', value: '12' },
        { key: 'throw_out_chance', value: '0.20' }
      ];
      for (const cfg of defaultPlinkoConfigs) {
        await run(`
          INSERT INTO plinko_config (key, value) VALUES ($1, $2)
        `, [cfg.key, cfg.value]);
      }
    }

    // 13. Crash Game State & Ledger
    await run(`
      CREATE TABLE IF NOT EXISTS crash_games (
        id SERIAL PRIMARY KEY,
        status VARCHAR(50) NOT NULL,
        crash_point DOUBLE PRECISION NOT NULL,
        server_seed TEXT NOT NULL,
        created_at VARCHAR(100) NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS crash_bets (
        id SERIAL PRIMARY KEY,
        game_id INTEGER NOT NULL,
        email VARCHAR(255) NOT NULL,
        bet_amount DOUBLE PRECISION NOT NULL,
        cashout_multiplier DOUBLE PRECISION,
        winnings DOUBLE PRECISION,
        status VARCHAR(50) NOT NULL,
        created_at VARCHAR(100) NOT NULL,
        FOREIGN KEY (game_id) REFERENCES crash_games(id) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS plinko_drops (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        wager_amount DOUBLE PRECISION NOT NULL,
        rows INTEGER NOT NULL,
        risk VARCHAR(50) NOT NULL,
        path TEXT NOT NULL,
        destination_bin INTEGER NOT NULL,
        multiplier DOUBLE PRECISION NOT NULL,
        payout DOUBLE PRECISION NOT NULL,
        server_seed VARCHAR(255) NOT NULL,
        client_seed VARCHAR(255) NOT NULL,
        nonce INTEGER NOT NULL,
        timestamp VARCHAR(100) NOT NULL
      )
    `);

    // 14. Affiliate Config & Referrals Schema
    await run(`
      CREATE TABLE IF NOT EXISTS user_referral_codes (
        email VARCHAR(255) PRIMARY KEY,
        referral_code VARCHAR(50) UNIQUE NOT NULL,
        referred_by VARCHAR(255),
        FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS referrals (
        id VARCHAR(255) PRIMARY KEY,
        referrer_email VARCHAR(255) NOT NULL,
        referee_email VARCHAR(255) UNIQUE NOT NULL,
        status VARCHAR(50) DEFAULT 'PENDING',
        bounty_claimed_at VARCHAR(100),
        created_at VARCHAR(100) NOT NULL,
        FOREIGN KEY(referrer_email) REFERENCES users(email) ON DELETE CASCADE,
        FOREIGN KEY(referee_email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS user_affiliate_wallets (
        email VARCHAR(255) PRIMARY KEY,
        commission_balance DOUBLE PRECISION DEFAULT 0.0,
        total_network_volume DOUBLE PRECISION DEFAULT 0.0,
        current_rank VARCHAR(50) DEFAULT 'BRONZE',
        FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS shadow_commission_logs (
        id SERIAL PRIMARY KEY,
        referee_email VARCHAR(255) NOT NULL,
        referrer_email VARCHAR(255) NOT NULL,
        wager_amount DOUBLE PRECISION NOT NULL,
        potential_commission DOUBLE PRECISION NOT NULL,
        timestamp VARCHAR(100) NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS affiliate_config (
        key VARCHAR(255) PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const affiliateCfgCount = await get('SELECT COUNT(*) as count FROM affiliate_config');
    if (parseInt(affiliateCfgCount.count, 10) === 0) {
      const defaultAffiliateConfigs = [
        { key: 'wager_commission_enabled', value: 'false' },
        { key: 'bounty_referrer_amount', value: '10' },
        { key: 'bounty_referee_free_drops', value: '10' },
        { key: 'min_deposit_threshold', value: '15' },
        { key: 'min_wager_threshold', value: '50' },
        { key: 'rank_bronze_multiplier', value: '0.05' },
        { key: 'rank_silver_multiplier', value: '0.10' },
        { key: 'rank_gold_multiplier', value: '0.15' },
        { key: 'rank_diamond_multiplier', value: '0.25' },
        { key: 'rank_silver_volume', value: '1000' },
        { key: 'rank_gold_volume', value: '10000' },
        { key: 'rank_diamond_volume', value: '100000' }
      ];
      for (const cfg of defaultAffiliateConfigs) {
        await run(`
          INSERT INTO affiliate_config (key, value) VALUES ($1, $2)
        `, [cfg.key, cfg.value]);
      }
    }

    console.log('[DB] PostgreSQL migrations completed successfully.');
  } else {
    // Original SQLite migrations
    console.log('[DB] Running SQLite migrations...');
    
    await run(`
      CREATE TABLE IF NOT EXISTS users (
        email TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password TEXT NOT NULL,
        balance REAL DEFAULT 1000.0,
        gamesPlayed INTEGER DEFAULT 0,
        totalWon REAL DEFAULT 0.0,
        role TEXT DEFAULT 'USER'
      )
    `);
   
    try {
      await run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER'");
      console.log('[DB] Migration: Added role column to users table.');
    } catch (err) {
      // Ignore if exists
    }

    await run(`
      CREATE TABLE IF NOT EXISTS loyalty_profiles (
        email TEXT PRIMARY KEY,
        points INTEGER DEFAULT 0,
        tier TEXT DEFAULT 'BRONZE',
        FOREIGN KEY(email) REFERENCES users(email)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        type TEXT NOT NULL,
        amount REAL NOT NULL,
        balanceAfter REAL NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS lottery_draws (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lotteryName TEXT NOT NULL,
        state TEXT NOT NULL,
        winningNumbers TEXT,
        timestamp TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS lottery_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        lotteryName TEXT NOT NULL,
        drawId INTEGER NOT NULL,
        chosenNumbers TEXT NOT NULL,
        betAmount REAL NOT NULL,
        claimed INTEGER DEFAULT 0,
        payout REAL DEFAULT 0.0,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS lottery_ticket_pool (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        lotteryName TEXT NOT NULL,
        drawId INTEGER NOT NULL,
        chosenNumbers TEXT NOT NULL,
        status TEXT DEFAULT 'AVAILABLE',
        reservedBy TEXT,
        reservedUntil TEXT,
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS audit_rng_logs (
        drawId INTEGER UNIQUE,
        lotteryName TEXT NOT NULL,
        seed TEXT NOT NULL,
        salt TEXT NOT NULL,
        hash TEXT NOT NULL,
        winningNumbers TEXT NOT NULL,
        timestamp TEXT NOT NULL,
        FOREIGN KEY(drawId) REFERENCES lottery_draws(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS game_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS games_config (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        draw_interval_ms INTEGER NOT NULL,
        ticket_price REAL NOT NULL,
        max_tickets_per_user INTEGER DEFAULT 100,
        house_edge_percentage REAL DEFAULT 0.30,
        status TEXT DEFAULT 'ACTIVE'
      )
    `);

    await run(`
      INSERT OR IGNORE INTO game_settings (key, value) VALUES ('kill_switch_active', 'false')
    `);

    const defaultGames = [
      { id: 'GAME-1', name: 'Sugar Rush 15', interval: 15000, price: 5.0 },
      { id: 'GAME-2', name: 'Sweet Treat 30', interval: 30000, price: 10.0 },
      { id: 'GAME-3', name: 'Glazed Gold', interval: 60000, price: 20.0 },
      { id: 'GAME-4', name: 'The Daily Dollop', interval: 120000, price: 50.0 },
      { id: 'GAME-5', name: 'The Weekly Whiff', interval: 300000, price: 100.0 },
      { id: 'GAME-6', name: 'The Grand Ganache', interval: 600000, price: 250.0 },
      { id: 'GAME-7', name: 'The Quarterly Banquet', interval: 900000, price: 500.0 }
    ];

    for (const g of defaultGames) {
      await run(`
        INSERT OR IGNORE INTO games_config (id, name, draw_interval_ms, ticket_price, house_edge_percentage, status)
        VALUES (?, ?, ?, ?, 0.30, 'ACTIVE')
      `, [g.id, g.name, g.interval, g.price]);
    }

    await run(`
      INSERT OR IGNORE INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
      VALUES ('demo@casino.com', 'DemoPlayer', 'password123', 1000.0, 0, 0.0, 'USER')
    `);
    
    await run(`
      INSERT OR IGNORE INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
      VALUES ('admin@casino.com', 'SuperAdmin', 'admin123', 99999.0, 0, 0.0, 'ADMIN')
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS spin_wheel_prizes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
        color TEXT NOT NULL,
        textColor TEXT NOT NULL,
        mult REAL NOT NULL,
        isBonus INTEGER DEFAULT 0
      )
    `);

    const prizesCount = await get('SELECT COUNT(*) as count FROM spin_wheel_prizes');
    if (prizesCount.count === 0) {
      const defaultPrizes = [
        { text: '10% CASHBACK', color: '#ff0055', textColor: '#ffffff', mult: 0.1, isBonus: 1 },
        { text: 'TRY AGAIN', color: '#111122', textColor: '#ffffff', mult: 0.0, isBonus: 0 },
        { text: 'FREE $10', color: '#00ffcc', textColor: '#000000', mult: 1.0, isBonus: 0 },
        { text: 'NO LUCK', color: '#1a1a30', textColor: '#ffffff', mult: 0.0, isBonus: 0 },
        { text: 'JACKPOT x5', color: '#ffcc00', textColor: '#000000', mult: 5.0, isBonus: 0 },
        { text: '20% BONUS', color: '#b500ff', textColor: '#ffffff', mult: 0.2, isBonus: 1 }
      ];

      for (const p of defaultPrizes) {
        await run(`
          INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus)
          VALUES (?, ?, ?, ?, ?)
        `, [p.text, p.color, p.textColor, p.mult, p.isBonus]);
      }
    }

    await run(`
      CREATE TABLE IF NOT EXISTS slots_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const slotsCfgCount = await get('SELECT COUNT(*) as count FROM slots_config');
    if (slotsCfgCount.count === 0) {
      const defaultSlotsConfigs = [
        { key: 'payout_strategy', value: 'FAIR_RNG' },
        { key: 'target_rtp', value: '0.90' },
        { key: 'symbols_config', value: JSON.stringify([
          { name: 'BAR', multiplier: 3, weight: 30, color: '#ff0055' },
          { name: 'CHERRY', multiplier: 5, weight: 25, color: '#ffcc00' },
          { name: 'BELL', multiplier: 10, weight: 20, color: '#00ffcc' },
          { name: 'DIAMOND', multiplier: 20, weight: 15, color: '#b500ff' },
          { name: 'SEVEN', multiplier: 50, weight: 8, color: '#00ff66' },
          { name: 'WILD', multiplier: 100, weight: 2, color: '#ffffff' }
        ])}
      ];

      for (const cfg of defaultSlotsConfigs) {
        await run(`
          INSERT INTO slots_config (key, value) VALUES (?, ?)
        `, [cfg.key, cfg.value]);
      }
    }

    await run(`
      CREATE TABLE IF NOT EXISTS dice_tournaments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        entry_fee REAL NOT NULL,
        prize_pool REAL NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS dice_tournament_participants (
        tournament_id INTEGER,
        email TEXT,
        rolls_left INTEGER DEFAULT 10,
        total_score INTEGER DEFAULT 0,
        completed INTEGER DEFAULT 0,
        PRIMARY KEY (tournament_id, email)
      )
    `);

    const tourneyCount = await get('SELECT COUNT(*) as count FROM dice_tournaments');
    if (tourneyCount.count === 0) {
      await run(`
        INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at)
        VALUES (?, ?, ?, ?, ?)
      `, ['🎰 NEON SHIELD DICE CLASH', 10.0, 100.0, 'ACTIVE', new Date().toISOString()]);
    }

    await run(`
      CREATE TABLE IF NOT EXISTS dice_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const diceCfgCount = await get('SELECT COUNT(*) as count FROM dice_config');
    if (diceCfgCount.count === 0) {
      const defaultDiceConfigs = [
        { key: 'mult_under_7', value: '2.3' },
        { key: 'mult_exact_7', value: '5.8' },
        { key: 'mult_over_7', value: '2.3' },
        { key: 'mult_doubles', value: '5.8' }
      ];
      for (const cfg of defaultDiceConfigs) {
        await run(`
          INSERT INTO dice_config (key, value) VALUES (?, ?)
        `, [cfg.key, cfg.value]);
      }
    }

    await run(`
      CREATE TABLE IF NOT EXISTS crash_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const crashCfgCount = await get('SELECT COUNT(*) as count FROM crash_config');
    if (crashCfgCount.count === 0) {
      const defaultCrashConfigs = [
        { key: 'lobby_time_ms', value: '5000' },
        { key: 'house_edge', value: '0.01' },
        { key: 'min_bet', value: '1' },
        { key: 'max_bet', value: '1000' },
        { key: 'max_multiplier', value: '10000' },
        { key: 'crash_delay_ms', value: '3000' }
      ];
      for (const cfg of defaultCrashConfigs) {
        await run(`
          INSERT INTO crash_config (key, value) VALUES (?, ?)
        `, [cfg.key, cfg.value]);
      }
    }

    await run(`
      CREATE TABLE IF NOT EXISTS plinko_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const plinkoCfgCount = await get('SELECT COUNT(*) as count FROM plinko_config');
    if (plinkoCfgCount.count === 0) {
      const defaultPlinkoConfigs = [
        { key: 'house_edge', value: '0.05' },
        { key: 'min_bet', value: '1' },
        { key: 'max_bet', value: '1000' },
        { key: 'rtp_bias', value: '12' },
        { key: 'throw_out_chance', value: '0.20' }
      ];
      for (const cfg of defaultPlinkoConfigs) {
        await run(`
          INSERT INTO plinko_config (key, value) VALUES (?, ?)
        `, [cfg.key, cfg.value]);
      }
    }

    await run(`
      CREATE TABLE IF NOT EXISTS crash_games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL,
        crash_point REAL NOT NULL,
        server_seed TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS crash_bets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        email TEXT NOT NULL,
        bet_amount REAL NOT NULL,
        cashout_multiplier REAL,
        winnings REAL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (game_id) REFERENCES crash_games(id)
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS plinko_drops (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL,
        wager_amount REAL NOT NULL,
        rows INTEGER NOT NULL,
        risk TEXT NOT NULL,
        path TEXT NOT NULL,
        destination_bin INTEGER NOT NULL,
        multiplier REAL NOT NULL,
        payout REAL NOT NULL,
        server_seed TEXT NOT NULL,
        client_seed TEXT NOT NULL,
        nonce INTEGER NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    // 14. Affiliate Config & Referrals Schema
    await run(`
      CREATE TABLE IF NOT EXISTS user_referral_codes (
        email TEXT PRIMARY KEY,
        referral_code TEXT UNIQUE NOT NULL,
        referred_by TEXT,
        FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS referrals (
        id TEXT PRIMARY KEY,
        referrer_email TEXT NOT NULL,
        referee_email TEXT UNIQUE NOT NULL,
        status TEXT DEFAULT 'PENDING',
        bounty_claimed_at TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY(referrer_email) REFERENCES users(email) ON DELETE CASCADE,
        FOREIGN KEY(referee_email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS user_affiliate_wallets (
        email TEXT PRIMARY KEY,
        commission_balance REAL DEFAULT 0.0,
        total_network_volume REAL DEFAULT 0.0,
        current_rank TEXT DEFAULT 'BRONZE',
        FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS shadow_commission_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        referee_email TEXT NOT NULL,
        referrer_email TEXT NOT NULL,
        wager_amount REAL NOT NULL,
        potential_commission REAL NOT NULL,
        timestamp TEXT NOT NULL
      )
    `);

    await run(`
      CREATE TABLE IF NOT EXISTS affiliate_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);

    const affiliateCfgCount = await get('SELECT COUNT(*) as count FROM affiliate_config');
    if (affiliateCfgCount.count === 0) {
      const defaultAffiliateConfigs = [
        { key: 'wager_commission_enabled', value: 'false' },
        { key: 'bounty_referrer_amount', value: '10' },
        { key: 'bounty_referee_free_drops', value: '10' },
        { key: 'min_deposit_threshold', value: '15' },
        { key: 'min_wager_threshold', value: '50' },
        { key: 'rank_bronze_multiplier', value: '0.05' },
        { key: 'rank_silver_multiplier', value: '0.10' },
        { key: 'rank_gold_multiplier', value: '0.15' },
        { key: 'rank_diamond_multiplier', value: '0.25' },
        { key: 'rank_silver_volume', value: '1000' },
        { key: 'rank_gold_volume', value: '10000' },
        { key: 'rank_diamond_volume', value: '100000' }
      ];
      for (const cfg of defaultAffiliateConfigs) {
        await run(`
          INSERT INTO affiliate_config (key, value) VALUES (?, ?)
        `, [cfg.key, cfg.value]);
      }
    }

    console.log('[DB] SQLite migrations completed successfully.');
  }
};

module.exports = {
  run,
  get,
  all,
  executeTransaction,
  initDatabase,
  dbPath,
  usePostgres
};
