import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-variants';

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_NAME, table]
  );
  return rows.length > 0;
}

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function indexExists(connection, table, indexName) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND INDEX_NAME = ?',
    [DB_NAME, table, indexName]
  );
  return rows.length > 0;
}

async function addColumnIfMissing(connection, table, column, ddl) {
  if (await columnExists(connection, table, column)) {
    console.log(`${table}.${column} already exists, skipping.`);
    return;
  }
  await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${ddl}`);
  console.log(`Added ${table}.${column}.`);
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

  if (!(await tableExists(connection, 'product_variants'))) {
    await connection.query(`
      CREATE TABLE product_variants (
        id INT AUTO_INCREMENT PRIMARY KEY,
        business_id INT NOT NULL,
        product_id INT NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        discount_price DECIMAL(10,2) NULL,
        stock INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
        FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
      )
    `);
    console.log('Created product_variants.');
  } else {
    console.log('product_variants already exists, skipping.');
  }

  if (!(await tableExists(connection, 'product_variant_options'))) {
    await connection.query(`
      CREATE TABLE product_variant_options (
        id INT AUTO_INCREMENT PRIMARY KEY,
        variant_id INT NOT NULL,
        option_id INT NOT NULL,
        UNIQUE KEY variant_option (variant_id, option_id),
        FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE,
        FOREIGN KEY (option_id) REFERENCES category_attribute_options(id) ON DELETE CASCADE
      )
    `);
    console.log('Created product_variant_options.');
  } else {
    console.log('product_variant_options already exists, skipping.');
  }

  await addColumnIfMissing(connection, 'cart_items', 'variant_id', 'INT NULL AFTER product_ref');
  await addColumnIfMissing(connection, 'cart_items', 'variant_label', 'VARCHAR(150) NULL AFTER product_name');
  await addColumnIfMissing(connection, 'order_items', 'variant_id', 'INT NULL AFTER product_ref');
  await addColumnIfMissing(connection, 'order_items', 'variant_label', 'VARCHAR(150) NULL AFTER product_name');

  // MySQL needs at least one index covering user_id for the cart_items -> users FK at all times,
  // so the wider key must be added before the old one is dropped.
  if (!(await indexExists(connection, 'cart_items', 'unique_user_product_variant'))) {
    await connection.query(
      'ALTER TABLE cart_items ADD UNIQUE KEY unique_user_product_variant (user_id, product_ref, variant_id)'
    );
    console.log('Added cart_items.unique_user_product_variant.');
  } else {
    console.log('cart_items.unique_user_product_variant already exists, skipping.');
  }
  if (await indexExists(connection, 'cart_items', 'unique_user_product')) {
    await connection.query('ALTER TABLE cart_items DROP INDEX unique_user_product');
    console.log('Dropped cart_items.unique_user_product.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product variants migration complete.');
}

run().catch((err) => {
  console.error('Product variants migration failed:', err);
  process.exit(1);
});
