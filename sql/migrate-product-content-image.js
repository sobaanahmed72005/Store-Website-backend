import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-content-image-columns';

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

  if (await columnExists(connection, 'products', 'content_image')) {
    console.log('products.content_image already exists, skipping.');
  } else {
    await connection.query('ALTER TABLE products ADD COLUMN content_image VARCHAR(255) AFTER dataset');
    console.log('Added products.content_image.');
  }

  if (await columnExists(connection, 'products', 'content_image_caption')) {
    console.log('products.content_image_caption already exists, skipping.');
  } else {
    await connection.query('ALTER TABLE products ADD COLUMN content_image_caption VARCHAR(255) AFTER content_image');
    console.log('Added products.content_image_caption.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product content image migration complete.');
}

run().catch((err) => {
  console.error('Product content image migration failed:', err);
  process.exit(1);
});
