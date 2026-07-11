import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function tableExists(connection, table) {
  const [rows] = await connection.query(
    'SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  return rows.length > 0;
}

async function addMissingColumns(connection, table, columns) {
  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
  );
  const existingNames = new Set(existing.map((r) => r.COLUMN_NAME));
  for (const column of columns) {
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
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

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
    console.log('Created product_variants table.');
  } else {
    console.log('product_variants table already exists, skipping.');
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
    console.log('Created product_variant_options table.');
  } else {
    console.log('product_variant_options table already exists, skipping.');
  }

  await addMissingColumns(connection, 'cart_items', [
    { name: 'variant_id', ddl: 'INT NULL AFTER product_ref' },
    { name: 'variant_label', ddl: 'VARCHAR(150) NULL AFTER product_name' },
  ]);
  await addMissingColumns(connection, 'order_items', [
    { name: 'variant_id', ddl: 'INT NULL AFTER product_ref' },
    { name: 'variant_label', ddl: 'VARCHAR(150) NULL AFTER product_name' },
  ]);

  const [indexRows] = await connection.query(
    "SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'cart_items' AND INDEX_NAME IN ('unique_user_product','unique_user_product_variant')",
    [process.env.DB_NAME]
  );
  const indexNames = new Set(indexRows.map((r) => r.INDEX_NAME));
  if (indexNames.has('unique_user_product') && !indexNames.has('unique_user_product_variant')) {
    // Add the new key before dropping the old one — MySQL refuses to drop unique_user_product
    // while it's the only index covering user_id, which the FK to users(id) needs for lookups.
    await connection.query('ALTER TABLE cart_items ADD UNIQUE KEY unique_user_product_variant (user_id, product_ref, variant_id)');
    await connection.query('ALTER TABLE cart_items DROP INDEX unique_user_product');
    console.log('Widened cart_items unique key to include variant_id.');
  } else {
    console.log('cart_items unique key already up to date, skipping.');
  }

  await connection.end();
  console.log('product-variants migration complete.');
}

run().catch((err) => {
  console.error('product-variants migration failed:', err);
  process.exit(1);
});
