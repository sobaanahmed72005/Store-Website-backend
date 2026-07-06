import { DB_CONFIG } from '../config/env.js';
import { getConnection } from './dbConnection.js';

const COLUMNS = [
  { name: 'payment_proof_image', ddl: 'VARCHAR(255) NULL' },
];

async function addMissingColumns(connection, table) {
  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [DB_CONFIG.NAME, table]
  );
  const existingNames = new Set(existing.map((row) => row.COLUMN_NAME));

  for (const column of COLUMNS) {
    if (existingNames.has(column.name)) {
      console.log(`${table}.${column.name} already exists, skipping.`);
      continue;
    }
    await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column.name}\` ${column.ddl}`);
    console.log(`Added ${table}.${column.name}.`);
  }
}

async function run() {
  const connection = await getConnection();

  await addMissingColumns(connection, 'orders');

  await connection.end();
  console.log('Payment proof migration complete.');
}

run().catch((err) => {
  console.error('Payment proof migration failed:', err);
  process.exit(1);
});
