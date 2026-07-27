import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from '../config/env.js';
import { ensureMigrationsTable, hasRun, recordMigration } from './migrationRunner.js';

const MIGRATION_NAME = 'add-product-spec-variant-scope';

async function columnExists(connection, table, column) {
  const [rows] = await connection.query(
    'SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [DB_NAME, table, column]
  );
  return rows.length > 0;
}

async function fkExists(connection, table, constraintName) {
  const [rows] = await connection.query(
    `SELECT 1 FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = ? AND CONSTRAINT_TYPE = 'FOREIGN KEY'`,
    [DB_NAME, table, constraintName]
  );
  return rows.length > 0;
}

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

  if (await columnExists(connection, 'product_specs', 'variant_id')) {
    console.log('product_specs.variant_id already exists, skipping.');
  } else {
    // NULL (the default for every pre-existing row) means "applies to every variant" — exactly
    // the same meaning a brand-new key spec gets if the admin leaves the new dropdown on its
    // default option, so no backfill is needed for specs created before this migration.
    await connection.query('ALTER TABLE product_specs ADD COLUMN variant_id INT NULL AFTER product_id');
    console.log('Added product_specs.variant_id.');
  }

  if (await fkExists(connection, 'product_specs', 'product_specs_ibfk_variant')) {
    console.log('product_specs_ibfk_variant already exists, skipping.');
  } else {
    await connection.query(
      `ALTER TABLE product_specs
       ADD CONSTRAINT product_specs_ibfk_variant FOREIGN KEY (variant_id) REFERENCES product_variants(id) ON DELETE CASCADE`
    );
    console.log('Added product_specs -> product_variants foreign key.');
  }

  await recordMigration(connection, MIGRATION_NAME);
  await connection.end();
  console.log('Product spec variant-scope migration complete.');
}

run().catch((err) => {
  console.error('Product spec variant-scope migration failed:', err);
  process.exit(1);
});
