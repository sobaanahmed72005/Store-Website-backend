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

  const [tables] = await connection.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sessions'",
    [process.env.DB_NAME]
  );

  if (tables.length === 0) {
    await connection.query(`
      CREATE TABLE sessions (
        id VARCHAR(64) PRIMARY KEY,
        user_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        revoked_at TIMESTAMP NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);
    console.log('Created sessions table.');
  } else {
    console.log('sessions table already exists, skipping.');
  }

  await connection.end();
  console.log('sessions migration complete.');
}

run().catch((err) => {
  console.error('sessions migration failed:', err);
  process.exit(1);
});
