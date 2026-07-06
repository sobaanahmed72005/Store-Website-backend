import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import { DB_CONFIG, ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } from '../config/env.js';
import { getConnection } from './dbConnection.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbName = DB_CONFIG.NAME;

async function run() {
  const connection = await getConnection({ withDatabase: false, multipleStatements: true });

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
