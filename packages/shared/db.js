const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Promisify database actions
const run = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Asynchronous ACID transaction runner
const executeTransaction = async (operationsCallback) => {
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
};

// Initialize SQLite Schema Tables
const initDatabase = async () => {
  console.log('[DB] Running SQLite migrations...');
  
  // 1. Users
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
 
  // Migration: Add role column if old users table exists without it
  try {
    await run("ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'USER'");
    console.log('[DB] Migration: Added role column to users table.');
  } catch (err) {
    // Ignore error if column already exists
  }

  // Gamification Profiles
  await run(`
    CREATE TABLE IF NOT EXISTS loyalty_profiles (
      email TEXT PRIMARY KEY,
      points INTEGER DEFAULT 0,
      tier TEXT DEFAULT 'BRONZE',
      FOREIGN KEY(email) REFERENCES users(email)
    )
  `);

  // 2. Transactions
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

  // 3. Lottery Draws
  await run(`
    CREATE TABLE IF NOT EXISTS lottery_draws (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lotteryName TEXT NOT NULL, -- Name of the lottery game (e.g. 'Sugar Rush 15')
      state TEXT NOT NULL, -- 'OPEN', 'LOCKED', 'DRAWING', 'COMPLETED'
      winningNumbers TEXT,
      timestamp TEXT NOT NULL
    )
  `);

  // 4. Lottery Tickets
  await run(`
    CREATE TABLE IF NOT EXISTS lottery_tickets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      lotteryName TEXT NOT NULL,
      drawId INTEGER NOT NULL,
      chosenNumbers TEXT NOT NULL,
      betAmount REAL NOT NULL,
      claimed INTEGER DEFAULT 0, -- 0 = Unprocessed, 1 = Processed
      payout REAL DEFAULT 0.0,
      timestamp TEXT NOT NULL,
      FOREIGN KEY(drawId) REFERENCES lottery_draws(id)
    )
  `);

  // 4.1. Pre-generated ticket pool for reservation model
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

  // 5. RNG Audit Trail Logs
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

  // 6. Game Settings (Kill-Switch config)
  await run(`
    CREATE TABLE IF NOT EXISTS game_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // 7. Dynamic Games Configuration
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

  // Seed default Settings
  await run(`
    INSERT OR IGNORE INTO game_settings (key, value) VALUES ('kill_switch_active', 'false')
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
      INSERT OR IGNORE INTO games_config (id, name, draw_interval_ms, ticket_price, house_edge_percentage, status)
      VALUES (?, ?, ?, ?, 0.30, 'ACTIVE')
    `, [g.id, g.name, g.interval, g.price]);
  }

  // Seed default Demo user and Admin
  await run(`
    INSERT OR IGNORE INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
    VALUES ('demo@casino.com', 'DemoPlayer', 'password123', 1000.0, 0, 0.0, 'USER')
  `);
  
  await run(`
    INSERT OR IGNORE INTO users (email, username, password, balance, gamesPlayed, totalWon, role) 
    VALUES ('admin@casino.com', 'SuperAdmin', 'admin123', 99999.0, 0, 0.0, 'ADMIN')
  `);

  // 8. Spin Wheel Configuration
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

  // 9. Slots Configuration Settings
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

  // 10. Dice Tournaments Configuration
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

  // 11. Dice Configuration Settings
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

  // 12. Crash Game State & Ledger
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

  console.log('[DB] SQLite migrations completed successfully.');
};

module.exports = {
  run,
  get,
  all,
  executeTransaction,
  initDatabase,
  dbPath
};
