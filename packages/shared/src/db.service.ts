import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';
import * as crypto from 'crypto';

const usePostgres = true;

async function hashBootstrapPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key as Buffer);
    });
  });
  return `scrypt$32768$8$1$${salt.toString('base64')}$${derived.toString('base64')}`;
}

@Injectable()
export class DbService implements OnModuleDestroy {
  public pgPool: Pool | null = null;

  constructor() {
    console.log('[DB] Connecting to PostgreSQL...');
    if (process.env.NODE_ENV === 'production') {
      if (!process.env.DATABASE_URL && (!process.env.PGPASSWORD || process.env.PGPASSWORD === 'postgres')) {
        throw new Error('A non-default PostgreSQL credential is required in production.');
      }
    }
    const poolConfig = process.env.DATABASE_URL 
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST || 'localhost',
          user: process.env.PGUSER || 'postgres',
          password: process.env.PGPASSWORD || 'postgres',
          database: process.env.PGDATABASE || 'cyber_casino',
          port: parseInt(process.env.PGPORT || '5432', 10),
        };
    this.pgPool = new Pool({
      ...poolConfig,
      max: parseInt(process.env.PG_POOL_MAX || '10', 10),
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });
    
    const checkConnection = async (retries = 10, delay = 3000) => {
      for (let i = 0; i < retries; i++) {
        try {
          const client = await this.pgPool.connect();
          client.release();
          console.log('[DB] Successfully connected to PostgreSQL.');
          return;
        } catch (err) {
          console.log(`[DB] Connection to PostgreSQL failed (Attempt ${i + 1}/${retries}). Retrying in ${delay / 1000}s...`);
          await new Promise(res => setTimeout(res, delay));
        }
      }
      console.error('[DB] Failed to connect to PostgreSQL after multiple retries.');
    };
    checkConnection();
  }

  onModuleDestroy() {
    if (this.pgPool) {
      this.pgPool.end();
    }
  }

  private translateQuery(sql: string): string {
    if (!usePostgres) return sql;

    let pgSql = sql;
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

    let index = 1;
    pgSql = pgSql.replace(/\?/g, () => `$${index++}`);

    pgSql = pgSql.replace(/"ACTIVE"/g, "'ACTIVE'");
    pgSql = pgSql.replace(/"BRONZE"/g, "'BRONZE'");
    pgSql = pgSql.replace(/"LOTTERY_WINOUT"/g, "'LOTTERY_WINOUT'");
    pgSql = pgSql.replace(/"LOCKED"/g, "'LOCKED'");
    pgSql = pgSql.replace(/"FLIGHT"/g, "'FLIGHT'");
    pgSql = pgSql.replace(/"CRASHED"/g, "'CRASHED'");
    pgSql = pgSql.replace(/"LOST"/g, "'LOST'");
    pgSql = pgSql.replace(/"kill_switch_active"/g, "'kill_switch_active'");

    return pgSql;
  }

  private pgRowToCamel(row: any) {
    if (!row) return undefined;
    const result: any = {};
    // PostgreSQL folds unquoted legacy camelCase identifiers to lowercase.
    // Restore their API names while retaining the raw keys for compatibility.
    const legacyNames: Record<string, string> = {
      gamesplayed: 'gamesPlayed', totalwon: 'totalWon', lotteryname: 'lotteryName',
      drawid: 'drawId', winningnumbers: 'winningNumbers', chosennumbers: 'chosenNumbers',
      betamount: 'betAmount', balanceafter: 'balanceAfter', textcolor: 'textColor',
      isbonus: 'isBonus', reservedby: 'reservedBy', reserveduntil: 'reservedUntil',
    };
    Object.keys(row).forEach(k => {
      if (k === 'count' || k === 'sum' || k === 'avg' || k === 'max' || k === 'min') {
        result[k] = row[k];
      } else {
        const camel = legacyNames[k] || k.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        result[camel] = row[k];
        if (camel !== k) result[k] = row[k];
      }
    });
    return result;
  }

  async run(sql: string, params: any[] = []): Promise<{ lastID: any; changes: number }> {
    let pgSql = this.translateQuery(sql);
    const isInsert = /^INSERT/i.test(pgSql);
    const targetsAutoincrement = /lottery_draws|lottery_tickets|lottery_ticket_pool|spin_wheel_prizes|dice_tournaments|crash_games|crash_bets|plinko_drops/i.test(pgSql);
    if (isInsert && targetsAutoincrement && !/RETURNING/i.test(pgSql)) {
      pgSql += ' RETURNING id';
    }
    const res = await this.pgPool.query(pgSql, params);
    const lastID = res.rows[0]?.id || null;
    return { lastID, changes: res.rowCount };
  }

  async get(sql: string, params: any[] = []): Promise<any> {
    const pgSql = this.translateQuery(sql);
    const res = await this.pgPool.query(pgSql, params);
    return this.pgRowToCamel(res.rows[0]);
  }

  async all(sql: string, params: any[] = []): Promise<any[]> {
    const pgSql = this.translateQuery(sql);
    const res = await this.pgPool.query(pgSql, params);
    return res.rows.map(row => this.pgRowToCamel(row));
  }

  async executeTransaction(operationsCallback: (tx: any) => Promise<any>): Promise<any> {
    const client = await this.pgPool.connect();
    try {
      // Financial operations must not observe stale balances when concurrent
      // wager/deposit/payout requests target the same account.
      await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
      
      const clientRun = (sql: string, params: any[] = []) => {
        let pgSql = this.translateQuery(sql);
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
      
      const clientGet = (sql: string, params: any[] = []) => client
        .query(this.translateQuery(sql), params)
        .then(res => this.pgRowToCamel(res.rows[0]));
      const clientAll = (sql: string, params: any[] = []) => client
        .query(this.translateQuery(sql), params)
        .then(res => res.rows.map(row => this.pgRowToCamel(row)));

      const result = await operationsCallback({ run: clientRun, get: clientGet, all: clientAll });
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async initDatabase() {
    let connected = false;
    for (let i = 0; i < 15; i++) {
      try {
        const client = await this.pgPool.connect();
        client.release();
        connected = true;
        break;
      } catch (err) {
        console.log(`[DB Migration] Waiting for database connection (Attempt ${i + 1}/15)...`);
        await new Promise(res => setTimeout(res, 2000));
      }
    }
    if (!connected) {
      throw new Error('[DB Migration] Could not connect to PostgreSQL. Migrations aborted.');
    }

    console.log('[DB] Running PostgreSQL schema migrations...');
    
    await this.run(`
        CREATE TABLE IF NOT EXISTS users (
          email VARCHAR(255) PRIMARY KEY,
          username VARCHAR(255) NOT NULL,
          password VARCHAR(255) NOT NULL,
          balance DOUBLE PRECISION DEFAULT 1000.0,
          gamesPlayed INTEGER DEFAULT 0,
          totalWon DOUBLE PRECISION DEFAULT 0.0,
          role VARCHAR(50) DEFAULT 'USER',
          status VARCHAR(50) DEFAULT 'ACTIVE',
          wallet_address VARCHAR(255)
        )
      `);

      await this.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(50) DEFAULT 'ACTIVE'`);
      await this.run(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wallet_address VARCHAR(255)`);

      await this.run(`
        CREATE TABLE IF NOT EXISTS loyalty_profiles (
          email VARCHAR(255) PRIMARY KEY,
          points INTEGER DEFAULT 0,
          tier VARCHAR(50) DEFAULT 'BRONZE',
          FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS transactions (
          id VARCHAR(255) PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          type VARCHAR(100) NOT NULL,
          amount DOUBLE PRECISION NOT NULL,
          balanceAfter DOUBLE PRECISION NOT NULL,
          timestamp VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS refresh_sessions (
          id VARCHAR(64) PRIMARY KEY,
          email VARCHAR(255) NOT NULL REFERENCES users(email) ON DELETE CASCADE,
          token_hash VARCHAR(64) UNIQUE NOT NULL,
          expires_at VARCHAR(100) NOT NULL,
          revoked_at VARCHAR(100),
          created_at VARCHAR(100) NOT NULL
        )
      `);
      await this.run('CREATE INDEX IF NOT EXISTS idx_refresh_sessions_email ON refresh_sessions(email)');

      await this.run(`
        CREATE TABLE IF NOT EXISTS ledger_entries (
          id VARCHAR(64) PRIMARY KEY,
          transaction_id VARCHAR(255) NOT NULL,
          email VARCHAR(255) NOT NULL REFERENCES users(email),
          account VARCHAR(64) NOT NULL,
          direction VARCHAR(6) NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
          amount NUMERIC(20, 8) NOT NULL CHECK (amount > 0),
          currency VARCHAR(16) NOT NULL DEFAULT 'USD',
          created_at VARCHAR(100) NOT NULL,
          UNIQUE(transaction_id, account)
        )
      `);
      await this.run(`
        CREATE TABLE IF NOT EXISTS payment_webhook_nonces (
          provider VARCHAR(64) NOT NULL,
          nonce VARCHAR(128) NOT NULL,
          received_at VARCHAR(100) NOT NULL,
          PRIMARY KEY(provider, nonce)
        )
      `);
      await this.run(`
        CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
        BEGIN RAISE EXCEPTION 'ledger entries are immutable'; END; $$ LANGUAGE plpgsql
      `);
      await this.run('DROP TRIGGER IF EXISTS ledger_immutable ON ledger_entries');
      await this.run(`
        CREATE TRIGGER ledger_immutable BEFORE UPDATE OR DELETE ON ledger_entries
        FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation()
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS lottery_draws (
          id SERIAL PRIMARY KEY,
          lotteryName VARCHAR(255) NOT NULL,
          state VARCHAR(50) NOT NULL,
          winningNumbers TEXT,
          timestamp VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
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

      await this.run(`
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

      await this.run(`
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

      await this.run(`
        CREATE TABLE IF NOT EXISTS game_settings (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      await this.run(`
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

      await this.run(`
        INSERT INTO game_settings (key, value) VALUES ('kill_switch_active', 'false') ON CONFLICT DO NOTHING
      `);

      const defaultGames = [
        { id: 'GAME-1', name: 'Sugar Rush 15', interval: 60000, price: 5.0 },
        { id: 'GAME-2', name: 'Sweet Treat 30', interval: 60000, price: 10.0 },
        { id: 'GAME-3', name: 'Glazed Gold', interval: 60000, price: 20.0 },
        { id: 'GAME-4', name: 'The Daily Dollop', interval: 120000, price: 50.0 },
        { id: 'GAME-5', name: 'The Weekly Whiff', interval: 300000, price: 100.0 },
        { id: 'GAME-6', name: 'The Grand Ganache', interval: 600000, price: 250.0 },
        { id: 'GAME-7', name: 'The Quarterly Banquet', interval: 900000, price: 500.0 }
      ];

      for (const g of defaultGames) {
        await this.run(`
          INSERT INTO games_config (id, name, draw_interval_ms, ticket_price, house_edge_percentage, status)
          VALUES ($1, $2, $3, $4, 0.30, 'ACTIVE') ON CONFLICT DO NOTHING
        `, [g.id, g.name, g.interval, g.price]);
      }
      // Checkout reservations last up to 30 seconds; shorter draw cycles make
      // successful checkout impossible and are therefore migrated to 60 seconds.
      await this.run('UPDATE games_config SET draw_interval_ms = 60000 WHERE draw_interval_ms < 60000');

      if (process.env.ENABLE_LOCAL_BOOTSTRAP === 'true') {
        const adminEmail = (process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@casino.com').trim().toLowerCase();
        const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || '';
        if (adminPassword.length < 12) {
          throw new Error('BOOTSTRAP_ADMIN_PASSWORD must contain at least 12 characters when local bootstrap is enabled.');
        }
        await this.run(`
          INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, role)
          VALUES ('demo@casino.com', 'DemoPlayer', $1, 1000.0, 0, 0.0, 'USER') ON CONFLICT DO NOTHING
        `, [await hashBootstrapPassword('password123')]);
        await this.run(`
          INSERT INTO users (email, username, password, balance, gamesPlayed, totalWon, role)
          VALUES ($1, 'SuperAdmin', $2, 99999.0, 0, 0.0, 'ADMIN') ON CONFLICT DO NOTHING
        `, [adminEmail, await hashBootstrapPassword(adminPassword)]);
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS spin_wheel_prizes (
          id SERIAL PRIMARY KEY,
          text VARCHAR(255) NOT NULL,
          color VARCHAR(50) NOT NULL,
          textColor VARCHAR(50) NOT NULL,
          mult DOUBLE PRECISION NOT NULL,
          isBonus INTEGER DEFAULT 0,
          display_order INTEGER DEFAULT 0
        )
      `);

      const prizesCount = await this.get('SELECT COUNT(*) as count FROM spin_wheel_prizes');
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
          await this.run(`
            INSERT INTO spin_wheel_prizes (text, color, textColor, mult, isBonus)
            VALUES ($1, $2, $3, $4, $5)
          `, [p.text, p.color, p.textColor, p.mult, p.isBonus]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS slots_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const slotsCfgCount = await this.get('SELECT COUNT(*) as count FROM slots_config');
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
          await this.run(`
            INSERT INTO slots_config (key, value) VALUES ($1, $2)
          `, [cfg.key, cfg.value]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS dice_tournaments (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          entry_fee DOUBLE PRECISION NOT NULL,
          prize_pool DOUBLE PRECISION NOT NULL,
          status VARCHAR(50) DEFAULT 'ACTIVE',
          created_at VARCHAR(100) NOT NULL,
          ends_at VARCHAR(100)
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS dice_tournament_participants (
          tournament_id INTEGER,
          email VARCHAR(255),
          rolls_left INTEGER DEFAULT 10,
          total_score INTEGER DEFAULT 0,
          completed INTEGER DEFAULT 0,
          PRIMARY KEY (tournament_id, email)
        )
      `);

      const tourneyCount = await this.get('SELECT COUNT(*) as count FROM dice_tournaments');
      if (parseInt(tourneyCount.count, 10) === 0) {
        await this.run(`
          INSERT INTO dice_tournaments (name, entry_fee, prize_pool, status, created_at, ends_at)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, ['🎰 NEON SHIELD DICE CLASH', 10.0, 100.0, 'ACTIVE', new Date().toISOString(), new Date(Date.now() + 86400000).toISOString()]);
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS dice_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const diceCfgCount = await this.get('SELECT COUNT(*) as count FROM dice_config');
      if (parseInt(diceCfgCount.count, 10) === 0) {
        const defaultDiceConfigs = [
          { key: 'mult_under_7', value: '2.3' },
          { key: 'mult_exact_7', value: '5.8' },
          { key: 'mult_over_7', value: '2.3' },
          { key: 'mult_doubles', value: '5.8' }
        ];
        for (const cfg of defaultDiceConfigs) {
          await this.run(`
            INSERT INTO dice_config (key, value) VALUES ($1, $2)
          `, [cfg.key, cfg.value]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS crash_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const crashCfgCount = await this.get('SELECT COUNT(*) as count FROM crash_config');
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
          await this.run(`
            INSERT INTO crash_config (key, value) VALUES ($1, $2)
          `, [cfg.key, cfg.value]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS plinko_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const plinkoCfgCount = await this.get('SELECT COUNT(*) as count FROM plinko_config');
      if (parseInt(plinkoCfgCount.count, 10) === 0) {
        const defaultPlinkoConfigs = [
          { key: 'house_edge', value: '0.05' },
          { key: 'min_bet', value: '1' },
          { key: 'max_bet', value: '1000' },
          { key: 'rtp_bias', value: '12' },
          { key: 'throw_out_chance', value: '0.20' }
        ];
        for (const cfg of defaultPlinkoConfigs) {
          await this.run(`
            INSERT INTO plinko_config (key, value) VALUES ($1, $2)
          `, [cfg.key, cfg.value]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS crash_games (
          id SERIAL PRIMARY KEY,
          status VARCHAR(50) NOT NULL,
          crash_point DOUBLE PRECISION NOT NULL,
          server_seed TEXT NOT NULL,
          created_at VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
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

      await this.run(`
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

      await this.run(`
        CREATE TABLE IF NOT EXISTS user_referral_codes (
          email VARCHAR(255) PRIMARY KEY,
          referral_code VARCHAR(50) UNIQUE NOT NULL,
          referred_by VARCHAR(255),
          FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
        )
      `);

      await this.run(`
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

      await this.run(`
        CREATE TABLE IF NOT EXISTS user_affiliate_wallets (
          email VARCHAR(255) PRIMARY KEY,
          commission_balance DOUBLE PRECISION DEFAULT 0.0,
          total_network_volume DOUBLE PRECISION DEFAULT 0.0,
          current_rank VARCHAR(50) DEFAULT 'BRONZE',
          FOREIGN KEY(email) REFERENCES users(email) ON DELETE CASCADE
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS shadow_commission_logs (
          id SERIAL PRIMARY KEY,
          referee_email VARCHAR(255) NOT NULL,
          referrer_email VARCHAR(255) NOT NULL,
          wager_amount DOUBLE PRECISION NOT NULL,
          potential_commission DOUBLE PRECISION NOT NULL,
          timestamp VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS affiliate_config (
          key VARCHAR(255) PRIMARY KEY,
          value TEXT NOT NULL
        )
      `);

      const affiliateCfgCount = await this.get('SELECT COUNT(*) as count FROM affiliate_config');
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
          await this.run(`
            INSERT INTO affiliate_config (key, value) VALUES ($1, $2)
          `, [cfg.key, cfg.value]);
        }
      }

      await this.run(`
        CREATE TABLE IF NOT EXISTS user_session_logs (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          ip_address VARCHAR(100) NOT NULL,
          user_agent VARCHAR(500) NOT NULL,
          device_fingerprint VARCHAR(255) NOT NULL,
          country VARCHAR(100),
          city VARCHAR(100),
          latitude DOUBLE PRECISION,
          longitude DOUBLE PRECISION,
          created_at VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS security_alerts (
          id SERIAL PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          alert_type VARCHAR(100) NOT NULL,
          severity VARCHAR(50) NOT NULL,
          details TEXT NOT NULL,
          resolved INTEGER DEFAULT 0,
          created_at VARCHAR(100) NOT NULL
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS user_tags (
          email VARCHAR(255) NOT NULL,
          tag VARCHAR(100) NOT NULL,
          PRIMARY KEY (email, tag)
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS bonus_rules (
          id SERIAL PRIMARY KEY,
          rule_name VARCHAR(255) NOT NULL,
          trigger_type VARCHAR(100) NOT NULL,
          threshold DOUBLE PRECISION NOT NULL,
          bonus_reward TEXT NOT NULL,
          active INTEGER DEFAULT 1
        )
      `);

      await this.run(`
        CREATE TABLE IF NOT EXISTS admin_audit_trail (
          id SERIAL PRIMARY KEY,
          admin_email VARCHAR(255) NOT NULL,
          action VARCHAR(100) NOT NULL,
          target_email VARCHAR(255),
          details TEXT NOT NULL,
          created_at VARCHAR(100) NOT NULL,
          request_id VARCHAR(128),
          previous_hash VARCHAR(64),
          entry_hash VARCHAR(64)
        )
      `);
      await this.run('ALTER TABLE admin_audit_trail ADD COLUMN IF NOT EXISTS request_id VARCHAR(128)');
      await this.run('ALTER TABLE admin_audit_trail ADD COLUMN IF NOT EXISTS previous_hash VARCHAR(64)');
      await this.run('ALTER TABLE admin_audit_trail ADD COLUMN IF NOT EXISTS entry_hash VARCHAR(64)');

      const rulesCount = await this.get('SELECT COUNT(*) as count FROM bonus_rules');
      if (parseInt(rulesCount.count, 10) === 0) {
        await this.run(`
          INSERT INTO bonus_rules (rule_name, trigger_type, threshold, bonus_reward, active)
          VALUES ($1, $2, $3, $4, $5)
        `, ['Hourly Loss Rebate', 'HOURLY_LOSS', 500.0, JSON.stringify({ type: 'FREE_DROPS', amount: 10 }), 1]);
      }

      console.log('[DB] PostgreSQL migrations completed successfully.');
  }
}
