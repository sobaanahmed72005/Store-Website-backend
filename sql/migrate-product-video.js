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

  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, 'products', 'video']
  );
  if (existing.length > 0) {
    console.log('products.video already exists, skipping.');
  } else {
    await connection.query('ALTER TABLE products ADD COLUMN video VARCHAR(255) AFTER image');
    console.log('Added products.video.');
  }

  await connection.end();
  console.log('product-video migration complete.');
}

run().catch((err) => {
  console.error('product-video migration failed:', err);
  process.exit(1);
});
