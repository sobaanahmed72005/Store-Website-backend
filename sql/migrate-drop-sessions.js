import { DB_CONFIG } from '../config/env.js';
import { getConnection } from './dbConnection.js';

// The sessions table backed the old session-revocation model. Auth is now pure JWT (see
// controllers/authController.js) — access and refresh tokens are both verified by signature
// alone, nothing reads or writes this table anymore.
async function run() {
  const connection = await getConnection();

  const [tables] = await connection.query(
    "SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'sessions'",
    [DB_CONFIG.NAME]
  );

  if (tables.length > 0) {
    await connection.query('DROP TABLE sessions');
    console.log('Dropped sessions table.');
  } else {
    console.log('sessions table does not exist, skipping.');
  }

  await connection.end();
  console.log('drop-sessions migration complete.');
}

run().catch((err) => {
  console.error('drop-sessions migration failed:', err);
  process.exit(1);
});
