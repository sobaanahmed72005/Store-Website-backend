import mysql from 'mysql2/promise';
import { DB_CONFIG } from '../config/env.js';

// One-off connection for standalone migration/seed scripts — these run once and exit, unlike
// the long-lived pool in config/db.js used by the running server. init.js passes
// withDatabase: false since the target database doesn't exist yet on a first run.
export function getConnection({ withDatabase = true, ...extra } = {}) {
  const config = {
    host: DB_CONFIG.HOST,
    port: DB_CONFIG.PORT,
    user: DB_CONFIG.USER,
    password: DB_CONFIG.PASSWORD,
    ...extra,
  };
  if (withDatabase) config.database = DB_CONFIG.NAME;
  return mysql.createConnection(config);
}
