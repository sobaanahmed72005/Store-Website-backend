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
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'courier_settings' AND COLUMN_NAME = 'shippers'`,
    [process.env.DB_NAME]
  );

  if (columns.length > 0) {
    console.log('courier_settings.shippers already exists, skipping.');
  } else {
    await connection.query(`ALTER TABLE courier_settings ADD COLUMN shippers TEXT NULL`);
    console.log('Added courier_settings.shippers column.');
  }

  await connection.end();
  console.log('courier-shippers migration complete.');
}

run().catch((err) => {
  console.error('courier-shippers migration failed:', err);
  process.exit(1);
});
