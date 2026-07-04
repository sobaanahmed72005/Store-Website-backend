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
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, 'discount_code_redemptions', 'single_use_guard']
  );

  if (columns.length === 0) {
    await connection.query('ALTER TABLE discount_code_redemptions ADD COLUMN single_use_guard INT NULL');
    console.log('Added discount_code_redemptions.single_use_guard.');

    // Backfill existing rows: guard = discount_code_id for codes that were single-use, else NULL.
    await connection.query(`
      UPDATE discount_code_redemptions r
      JOIN discount_codes c ON c.id = r.discount_code_id
      SET r.single_use_guard = IF(c.reusable = 0, r.discount_code_id, NULL)
    `);
    console.log('Backfilled single_use_guard for existing redemptions.');
  } else {
    console.log('discount_code_redemptions.single_use_guard already exists, skipping column add.');
  }

  const [indexes] = await connection.query(
    "SHOW INDEX FROM discount_code_redemptions WHERE Key_name = 'single_use_guard_user'"
  );
  if (indexes.length === 0) {
    const [dupes] = await connection.query(`
      SELECT single_use_guard, user_id, COUNT(*) AS n
      FROM discount_code_redemptions
      WHERE single_use_guard IS NOT NULL
      GROUP BY single_use_guard, user_id
      HAVING n > 1
    `);
    if (dupes.length > 0) {
      console.error(
        `Found ${dupes.length} existing (code, user) pair(s) that already redeemed a single-use ` +
        `code more than once — the unique index cannot be added until these are resolved manually ` +
        `(e.g. delete the duplicate redemption rows you want to disregard). Skipping index creation.`
      );
    } else {
      await connection.query(
        'ALTER TABLE discount_code_redemptions ADD UNIQUE KEY single_use_guard_user (single_use_guard, user_id)'
      );
      console.log('Added unique index single_use_guard_user.');
    }
  } else {
    console.log('Unique index single_use_guard_user already exists, skipping.');
  }

  await connection.end();
  console.log('discount-guard migration complete.');
}

run().catch((err) => {
  console.error('discount-guard migration failed:', err);
  process.exit(1);
});
