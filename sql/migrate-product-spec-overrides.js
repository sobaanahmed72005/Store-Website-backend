import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-spec-overrides';

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_NAME, table]
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

  if (!(await tableExists(connection, 'product_spec_overrides'))) {
    await connection.query(`
      CREATE TABLE product_spec_overrides (
        id INT AUTO_INCREMENT PRIMARY KEY,
        product_id INT NOT NULL,
        attribute_name VARCHAR(100) NOT NULL,
        value VARCHAR(255) NOT NULL,
        UNIQUE KEY product_attribute (product_id, attribute_name),
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('Created product_spec_overrides.');
  } else {
    console.log('product_spec_overrides already exists, skipping.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product spec overrides migration complete.');
}

run().catch((err) => {
  console.error('Product spec overrides migration failed:', err);
  process.exit(1);
});
