import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-content-video-columns';

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(connection, column, definition, after) {
  if (await columnExists(connection, 'products', column)) {
    console.log(`products.${column} already exists, skipping.`);
    return;
  }
  await connection.query(`ALTER TABLE products ADD COLUMN ${column} ${definition} AFTER ${after}`);
  console.log(`Added products.${column}.`);
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

  await addColumnIfMissing(connection, 'content_video_url', 'VARCHAR(255)', 'content_image_caption');
  await addColumnIfMissing(connection, 'content_video_title', 'VARCHAR(255)', 'content_video_url');
  await addColumnIfMissing(connection, 'content_video_caption', 'VARCHAR(255)', 'content_video_title');

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product content video migration complete.');
}

run().catch((err) => {
  console.error('Product content video migration failed:', err);
  process.exit(1);
});
