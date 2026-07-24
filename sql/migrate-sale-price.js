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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'order_items' AND COLUMN_NAME = 'is_sale_price'`,
    [process.env.DB_NAME]
  );

  if (columns.length > 0) {
    console.log('order_items.is_sale_price already exists, skipping.');
  } else {
    await connection.query(`ALTER TABLE order_items ADD COLUMN is_sale_price TINYINT(1) NULL`);
    console.log('Added order_items.is_sale_price.');
  }

  await connection.end();
  console.log('sale-price migration complete.');
}

run().catch((err) => {
  console.error('sale-price migration failed:', err);
  process.exit(1);
});
