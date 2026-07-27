import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-variant-description';

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, table, column]
  );
  return rows.length > 0;
}

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

  if (await columnExists(connection, 'product_variants', 'description')) {
    console.log('product_variants.description already exists, skipping.');
  } else {
    await connection.query('ALTER TABLE product_variants ADD COLUMN description TEXT NULL');
    console.log('Added product_variants.description.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Variant description migration complete.');
}

run().catch((err) => {
  console.error('Variant description migration failed:', err);
  process.exit(1);
});
