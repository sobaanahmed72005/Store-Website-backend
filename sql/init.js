import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } from '../config/env.js';
import { recordMigration } from './migrationRunner.js';
import { passwordLengthError } from '../utils/validation.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbName = DB_NAME;

// schema.sql already includes every change the sql/migrate-*.js scripts make (they only exist
// to bring an *older* database up to date incrementally) — so a fresh install needs all of them
// marked as already applied, or `npm run db:migrate` would try to re-apply changes that are
// already baked into the schema it just created and fail on "column already exists".
const ALL_MIGRATIONS = [
  'add-2fa-columns',
  'add-updated-at-columns',
  'add-token-version-column',
  'add-discount-guard-constraint',
  'add-sessions-table',
  'add-payment-proof-columns',
];

async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST,
    port: DB_PORT,
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${dbName}\``);

  // schema.sql opens with its own hardcoded `CREATE DATABASE czone_clone; USE czone_clone;` —
  // strip those two statements so the rest of the schema runs against the configured DB_NAME
  // instead of silently creating tables in a database named "czone_clone" regardless of config.
  const schemaSql = fs
    .readFileSync(path.join(__dirname, 'schema.sql'), 'utf8')
    .replace(/^\s*CREATE DATABASE[^;]*;\s*USE\s+\S+;\s*/i, '');
  await connection.query(schemaSql);
  console.log(`Schema applied to database "${dbName}".`);

  for (const name of ALL_MIGRATIONS) {
    await recordMigration(connection, name);
  }
  console.log('Marked all migrations as already applied (schema.sql already includes them).');

  const [businessRows] = await connection.query('SELECT id FROM businesses WHERE slug = ?', ['main']);
  let businessId = businessRows[0]?.id;
  if (!businessId) {
    const [result] = await connection.query(
      "INSERT INTO businesses (name, slug, status) VALUES (?, 'main', 'active')",
      ['My Store'],
    );
    businessId = result.insertId;
    console.log(`Created business "My Store" (slug: main).`);
  } else {
    console.log('Business with slug "main" already exists, skipping.');
  }

  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    // Every other account in this app (register, change-password, reset-password) is rejected if
    // its password fails this same check — the seeded admin account is the one place that used
    // to bypass it entirely, silently creating a full admin account with whatever ADMIN_PASSWORD
    // an operator happened to set, no matter how weak. Fail loudly here instead, the same way
    // config/env.js already does for a weak/missing JWT_SECRET.
    const weakPasswordError = passwordLengthError(ADMIN_PASSWORD);
    if (weakPasswordError) {
      throw new Error(`ADMIN_PASSWORD is too weak: ${weakPasswordError}. Set a stronger value and re-run.`);
    }

    const [adminRows] = await connection.query(
      'SELECT id FROM users WHERE business_id = ? AND email = ?',
      [businessId, ADMIN_EMAIL],
    );
    if (adminRows.length === 0) {
      const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
      const [result] = await connection.query(
        `INSERT INTO users (business_id, name, email, password_hash, role, email_verified)
         VALUES (?, ?, ?, ?, 'admin', 1)`,
        [businessId, ADMIN_NAME, ADMIN_EMAIL, passwordHash],
      );
      await connection.query('UPDATE businesses SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL', [result.insertId, businessId]);
      console.log(`Created store admin account: ${ADMIN_EMAIL}`);
    } else {
      console.log(`Store admin ${ADMIN_EMAIL} already exists, skipping.`);
    }
  } else {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping store admin seed.');
  }

  await connection.end();
  console.log('Database initialization complete.');
}

run().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
