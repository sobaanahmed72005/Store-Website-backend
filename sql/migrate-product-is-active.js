import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  const [columns] = await connection.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'products' AND COLUMN_NAME = 'is_active'`,
    [process.env.DB_NAME]
  );

  if (columns.length > 0) {
    console.log('products.is_active already exists, skipping.');
  } else {
    await connection.query(`ALTER TABLE products ADD COLUMN is_active TINYINT(1) NOT NULL DEFAULT 1`);
    console.log('Added products.is_active column.');
  }

  await connection.end();
  console.log('product-is-active migration complete.');
}

run().catch((err) => {
  console.error('product-is-active migration failed:', err);
  process.exit(1);
});
