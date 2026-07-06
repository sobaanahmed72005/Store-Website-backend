import mysql from 'mysql2/promise';
import { DB_CONFIG } from './env.js';

const pool = mysql.createPool({
  host: DB_CONFIG.HOST,
  port: DB_CONFIG.PORT,
  user: DB_CONFIG.USER,
  password: DB_CONFIG.PASSWORD,
  database: DB_CONFIG.NAME,
  waitForConnections: true,
  connectionLimit: 10,
});

export default pool;
