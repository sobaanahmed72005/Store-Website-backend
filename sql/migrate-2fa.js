import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';

const COLUMNS = [
  { name: 'totp_secret', ddl: 'VARCHAR(255) NULL' },
  { name: 'totp_enabled', ddl: 'TINYINT(1) NOT NULL DEFAULT 0' },
  { name: 'totp_recovery_codes', ddl: 'TEXT NULL' },
];

async function addMissingColumns(connection, table) {
  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_NAME, table]
  );
  const existingNames = new Set(existing.map((row) => row.COLUMN_NAME));

  for (const column of COLUMNS) {
    if (existingNames.has(column.name)) {
      console.log(`${table}.${column.name} already exists, skipping.`);
      continue;
    }
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` ${column.ddl}`);
    console.log(`Added ${table}.${column.name}.`);
  }
}

async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  await addMissingColumns(connection, 'users');

  await connection.end();
  console.log('2FA migration complete.');
}

run().catch((err) => {
  console.error('2FA migration failed:', err);
  process.exit(1);
});
