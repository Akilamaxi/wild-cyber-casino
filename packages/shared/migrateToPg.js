/**
 * SQLite to PostgreSQL Data Migration Script
 * Usage: PGUSER=postgres PGPASSWORD=postgres PGHOST=localhost PGDATABASE=cyber_casino PGPORT=5432 node migrateToPg.js
 */

const { Client } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const dbConnector = require('./db');

// Ensure PostgreSQL is enabled before running migration
if (!dbConnector.usePostgres) {
  console.error('ERROR: PostgreSQL connection environment variables are not set! Run the script with PG environment variables.');
  process.exit(1);
}

const sqliteDbPath = path.join(__dirname, 'database.sqlite');
console.log(`[Migration] Reading from SQLite database: ${sqliteDbPath}`);

const sqliteDb = new sqlite3.Database(sqliteDbPath);

const pgConfig = process.env.DATABASE_URL 
  ? { connectionString: process.env.DATABASE_URL }
  : {
      host: process.env.PGHOST || 'localhost',
      user: process.env.PGUSER || 'postgres',
      password: process.env.PGPASSWORD || 'postgres',
      database: process.env.PGDATABASE || 'cyber_casino',
      port: parseInt(process.env.PGPORT || '5432', 10),
    };

const pgClient = new Client(pgConfig);

// Helper to query SQLite
const querySqlite = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    sqliteDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

const tablesToMigrate = [
  { name: 'users', primaryKey: 'email', hasSerial: false },
  { name: 'loyalty_profiles', primaryKey: 'email', hasSerial: false },
  { name: 'transactions', primaryKey: 'id', hasSerial: false },
  { name: 'lottery_draws', primaryKey: 'id', hasSerial: true },
  { name: 'lottery_tickets', primaryKey: 'id', hasSerial: true },
  { name: 'lottery_ticket_pool', primaryKey: 'id', hasSerial: true },
  { name: 'audit_rng_logs', primaryKey: 'drawId', hasSerial: false },
  { name: 'game_settings', primaryKey: 'key', hasSerial: false },
  { name: 'games_config', primaryKey: 'id', hasSerial: false },
  { name: 'spin_wheel_prizes', primaryKey: 'id', hasSerial: true },
  { name: 'slots_config', primaryKey: 'key', hasSerial: false },
  { name: 'dice_tournaments', primaryKey: 'id', hasSerial: true },
  { name: 'dice_tournament_participants', primaryKey: 'tournament_id, email', hasSerial: false },
  { name: 'dice_config', primaryKey: 'key', hasSerial: false },
  { name: 'crash_config', primaryKey: 'key', hasSerial: false },
  { name: 'crash_games', primaryKey: 'id', hasSerial: true },
  { name: 'crash_bets', primaryKey: 'id', hasSerial: true }
];

const startMigration = async () => {
  console.log('[Migration] Starting schema initialization...');
  await dbConnector.initDatabase();

  console.log('[Migration] Connecting to PostgreSQL server...');
  await pgClient.connect();

  console.log('[Migration] Commencing table data transfer...');

  for (const table of tablesToMigrate) {
    try {
      console.log(`\n----------------------------------------`);
      console.log(`[Migration] Migrating table: ${table.name}`);

      // Check if table exists in SQLite
      const sqliteRows = await querySqlite(`SELECT * FROM ${table.name}`).catch(() => null);
      if (!sqliteRows) {
        console.warn(`[Migration] Table ${table.name} not found in SQLite. Skipping.`);
        continue;
      }

      if (sqliteRows.length === 0) {
        console.log(`[Migration] Table ${table.name} has 0 records. Skipping.`);
        continue;
      }

      console.log(`[Migration] Found ${sqliteRows.length} records in SQLite.`);

      // Clear any default seeded values in Postgres to prevent conflict
      await pgClient.query(`TRUNCATE TABLE ${table.name} CASCADE`);

      const columns = Object.keys(sqliteRows[0]);
      const columnNamesCsv = columns.join(', ');
      
      // Batch inserts
      for (const row of sqliteRows) {
        const values = columns.map(col => row[col]);
        const placeholders = columns.map((_, idx) => `$${idx + 1}`).join(', ');
        
        const insertQuery = `
          INSERT INTO ${table.name} (${columnNamesCsv})
          VALUES (${placeholders})
          ON CONFLICT DO NOTHING
        `;
        
        await pgClient.query(insertQuery, values);
      }

      console.log(`[Migration] Successfully transferred records to PostgreSQL for table ${table.name}.`);

      // Reset serial sequence in Postgres
      if (table.hasSerial) {
        const seqName = `${table.name}_id_seq`;
        console.log(`[Migration] Resetting sequence sequence: ${seqName}`);
        await pgClient.query(`
          SELECT setval('${seqName}', COALESCE((SELECT MAX(id) FROM ${table.name}), 1))
        `);
      }

    } catch (err) {
      console.error(`[Migration] Error migrating table ${table.name}:`, err);
    }
  }

  console.log(`\n----------------------------------------`);
  console.log('[Migration] Data migration successfully completed!');
  
  // Close database connections
  sqliteDb.close();
  await pgClient.end();
};

startMigration().catch(err => {
  console.error('[Migration] Migration script crashed:', err);
  process.exit(1);
});
