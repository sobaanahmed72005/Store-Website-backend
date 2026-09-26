import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-dataset-text-column';

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

  if (await columnExists(connection, 'products', 'dataset_text')) {
    console.log('products.dataset_text already exists, skipping.');
  } else {
    await connection.query('ALTER TABLE products ADD COLUMN dataset_text MEDIUMTEXT AFTER dataset');
    console.log('Added products.dataset_text.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product dataset text migration complete.');
}

run().catch((err) => {
  console.error('Product dataset text migration failed:', err);
  process.exit(1);
});
