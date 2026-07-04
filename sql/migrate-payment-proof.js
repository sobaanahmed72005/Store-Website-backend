import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const COLUMNS = [
  { name: 'payment_proof_image', ddl: 'VARCHAR(255) NULL' },
];

async function addMissingColumns(connection, table) {
  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?',
    [process.env.DB_NAME, table]
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
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await addMissingColumns(connection, 'orders');

  await connection.end();
  console.log('Payment proof migration complete.');
}

run().catch((err) => {
  console.error('Payment proof migration failed:', err);
  process.exit(1);
});
