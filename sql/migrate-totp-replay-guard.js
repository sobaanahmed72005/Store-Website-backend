import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-totp-replay-guard';

// otplib's verify() accepts an `afterTimeStep` option and returns the matched `timeStep` on
// success — this column persists the last one a user's code was accepted at, so the same 6-digit
// code can't be replayed a second time within its ~90s validity window (see docs/AUDIT.md).
async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  });

  await ensureMigrationsTable(connection);
  if (await hasRun(connection, MIGRATION_NAME)) {
    console.log(`${MIGRATION_NAME} already applied, skipping.`);
    await connection.end();
    return;
  }

  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, 'users', 'totp_last_step']
  );
  if (columns.length === 0) {
    await connection.query('ALTER TABLE users ADD COLUMN totp_last_step BIGINT NULL');
    console.log('Added users.totp_last_step.');
  } else {
    console.log('users.totp_last_step already exists, skipping.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('totp-replay-guard migration complete.');
}

run().catch((err) => {
  console.error('totp-replay-guard migration failed:', err);
  process.exit(1);
});
