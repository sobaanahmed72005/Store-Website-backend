import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-verification-token-expires';

async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await ensureMigrationsTable(connection);
  if (await hasRun(connection, MIGRATION_NAME)) {
    console.log(`${MIGRATION_NAME} already applied, skipping.`);
    await connection.end();
    return;
  }

  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, 'users', 'verification_token_expires']
  );
  if (existing.length === 0) {
    await connection.query('ALTER TABLE `users` ADD COLUMN `verification_token_expires` DATETIME NULL');
    console.log('Added users.verification_token_expires.');
  } else {
    console.log('users.verification_token_expires already exists, skipping.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Verification token expiry migration complete.');
}

run().catch((err) => {
  console.error('Verification token expiry migration failed:', err);
  process.exit(1);
});
