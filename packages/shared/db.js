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
      totalWon REAL DEFAULT 0.0
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

  // Seed default Settings
  await run(`
    INSERT OR IGNORE INTO game_settings (key, value) VALUES ('kill_switch_active', 'false')
  `);

  // Seed default Demo user
  await run(`
    INSERT OR IGNORE INTO users (email, username, password, balance, gamesPlayed, totalWon) 
    VALUES ('demo@casino.com', 'DemoPlayer', 'password123', 1000.0, 0, 0.0)
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
