import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbName = process.env.DB_NAME;

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
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

  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const [adminRows] = await connection.query(
      'SELECT id FROM users WHERE business_id = ? AND email = ?',
      [businessId, process.env.ADMIN_EMAIL],
    );
    if (adminRows.length === 0) {
      const passwordHash = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      const [result] = await connection.query(
        `INSERT INTO users (business_id, name, email, password_hash, role, email_verified)
         VALUES (?, ?, ?, ?, 'admin', 1)`,
        [businessId, process.env.ADMIN_NAME || 'Store Admin', process.env.ADMIN_EMAIL, passwordHash],
      );
      await connection.query('UPDATE businesses SET owner_user_id = ? WHERE id = ? AND owner_user_id IS NULL', [result.insertId, businessId]);
      console.log(`Created store admin account: ${process.env.ADMIN_EMAIL}`);
    } else {
      console.log(`Store admin ${process.env.ADMIN_EMAIL} already exists, skipping.`);
    }
  } else {
    console.log('ADMIN_EMAIL / ADMIN_PASSWORD not set — skipping store admin seed.');
  }

  if (process.env.PLATFORM_ADMIN_EMAIL && process.env.PLATFORM_ADMIN_PASSWORD) {
    const [platformRows] = await connection.query(
      'SELECT id FROM platform_admins WHERE email = ?',
      [process.env.PLATFORM_ADMIN_EMAIL],
    );
    if (platformRows.length === 0) {
      const passwordHash = await bcrypt.hash(process.env.PLATFORM_ADMIN_PASSWORD, 10);
      await connection.query(
        'INSERT INTO platform_admins (name, email, password_hash) VALUES (?, ?, ?)',
        [process.env.PLATFORM_ADMIN_NAME || 'Platform Owner', process.env.PLATFORM_ADMIN_EMAIL, passwordHash],
      );
      console.log(`Created platform admin account: ${process.env.PLATFORM_ADMIN_EMAIL}`);
    } else {
      console.log(`Platform admin ${process.env.PLATFORM_ADMIN_EMAIL} already exists, skipping.`);
    }
  } else {
    console.log('PLATFORM_ADMIN_EMAIL / PLATFORM_ADMIN_PASSWORD not set — skipping platform admin seed.');
  }

  await connection.end();
  console.log('Database initialization complete.');
}

run().catch((err) => {
  console.error('Database initialization failed:', err);
  process.exit(1);
});
