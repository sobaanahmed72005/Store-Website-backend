import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const COLUMN = { name: 'updated_at', ddl: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' };

async function addMissingColumn(connection, table) {
  const [existing] = await connection.query(
    'SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [process.env.DB_NAME, table, COLUMN.name]
  );
  if (existing.length > 0) {
    console.log(`${table}.${COLUMN.name} already exists, skipping.`);
    return;
  }
  await connection.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${COLUMN.name}\` ${COLUMN.ddl}`);
  console.log(`Added ${table}.${COLUMN.name}.`);
}

async function run() {
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });

  await addMissingColumn(connection, 'products');
  await addMissingColumn(connection, 'categories');

  await connection.end();
  console.log('updated_at migration complete.');
}

run().catch((err) => {
  console.error('updated_at migration failed:', err);
  process.exit(1);
});
