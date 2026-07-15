import mysql from 'mysql2/promise';
import { DB_HOST, DB_PORT, DB_USER, DB_PASSWORD, DB_NAME } from './env.js';

const pool = mysql.createPool({
  host: DB_HOST,
  port: DB_PORT,
  user: DB_USER,
  password: DB_PASSWORD,
  database: DB_NAME,
  waitForConnections: true,
  connectionLimit: Number(process.env.DB_POOL_SIZE) || 20,
  // A spike that exceeds the pool used to queue every extra request indefinitely (queueLimit
  // defaults to 0 = unlimited) — memory grows unbounded and every request, including ones that
  // would otherwise succeed fast, waits behind the pile-up. Failing fast past this point lets
  // the app shed load with a normal error instead of degrading into a slow death.
  queueLimit: 50,
  connectTimeout: 10_000,
});

export default pool;
