import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-scale-indexes';

// Adds indexes that matter once a tenant's catalog/order history grows past a few thousand rows
// — see docs/AUDIT.md (Critical #4, High #3). Safe to run on a database that already has them
// (each is guarded by its own "does this index already exist" check, same pattern as every other
// migration here).
const INDEXES = [
  { table: 'orders', name: 'idx_orders_business_reference', ddl: 'ALTER TABLE orders ADD KEY idx_orders_business_reference (business_id, payment_reference)' },
  { table: 'orders', name: 'idx_orders_business_proof_image', ddl: 'ALTER TABLE orders ADD KEY idx_orders_business_proof_image (business_id, payment_proof_image)' },
  { table: 'products', name: 'idx_products_business_created', ddl: 'ALTER TABLE products ADD KEY idx_products_business_created (business_id, created_at)' },
  { table: 'products', name: 'idx_products_business_category_created', ddl: 'ALTER TABLE products ADD KEY idx_products_business_category_created (business_id, category_id, created_at)' },
];

async function run() {
  const connection = await mysql.createConnection({
    host: DB_HOST, port: DB_PORT, user: DB_USER, password: DB_PASSWORD, database: DB_NAME,
  });

  await ensureMigrationsTable(connection);
  if (await hasRun(connection, MIGRATION_NAME)) {
    console.log(`${MIGRATION_NAME} already applied, skipping.`);
    await connection.end();
    return;
  }

  for (const { table, name, ddl } of INDEXES) {
    const [existing] = await connection.query('SHOW INDEX FROM ?? WHERE Key_name = ?', [table, name]);
    if (existing.length > 0) {
      console.log(`${table}.${name} already exists, skipping.`);
      continue;
    }
    await connection.query(ddl);
    console.log(`Added ${table}.${name}.`);
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('scale-indexes migration complete.');
}

run().catch((err) => {
  console.error('scale-indexes migration failed:', err);
  process.exit(1);
});
