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
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'product_reviews' AND COLUMN_NAME = 'status'`,
    [process.env.DB_NAME]
  );

  if (columns.length === 0) {
    console.error('product_reviews.status column not found — is the schema initialized?');
  } else if (columns[0].COLUMN_TYPE.includes("'rejected'")) {
    console.log("product_reviews.status already includes 'rejected', skipping.");
  } else {
    await connection.query(
      `ALTER TABLE product_reviews
       MODIFY COLUMN status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending'`
    );
    console.log("Added 'rejected' to product_reviews.status.");
  }

  await connection.end();
  console.log('review-status migration complete.');
}

run().catch((err) => {
  console.error('review-status migration failed:', err);
  process.exit(1);
});
