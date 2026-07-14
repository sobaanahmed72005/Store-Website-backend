import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-discount-guard-constraint';

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

  const [columns] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, 'discount_code_redemptions', 'single_use_guard']
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
  let indexReady = indexes.length > 0;
  if (!indexReady) {
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
      indexReady = true;
    }
  } else {
    console.log('Unique index single_use_guard_user already exists, skipping.');
  }

  // Only recorded as applied once the index actually exists — if it's still blocked on unresolved
  // duplicate rows above, this needs to run again (and keep re-checking) after that's fixed, not
  // get marked done while the actual DB-level guard is still missing.
  if (indexReady) {
    await recordMigration(connection, MIGRATION_NAME);
  }

  await connection.end();
  console.log('discount-guard migration complete.');
}

run().catch((err) => {
  console.error('discount-guard migration failed:', err);
  process.exit(1);
});
