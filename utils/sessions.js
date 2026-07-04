import crypto from 'crypto';
import pool from '../config/db.js';

// One row per login (see sql/schema.sql). The id is an unguessable random token, not a
// sequential int, so it can safely live inside the JWT without leaking how many sessions
// exist. Revoking a single row logs out exactly one device; revoking every row for a
// user_id logs out everywhere at once (used by password change / 2FA disable).

export async function createSession(userId, queryRunner = pool) {
  const id = crypto.randomBytes(32).toString('hex');
  await queryRunner.query('INSERT INTO sessions (id, user_id) VALUES (?, ?)', [id, userId]);
  return id;
}

export async function revokeSession(sessionId) {
  await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE id = ?', [sessionId]);
}

export async function revokeAllSessions(userId) {
  await pool.query('UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [userId]);
}

// Sessions outlive their JWT's 7-day expiry by design (so a revoked row stays revoked, not
// because anyone still needs it) — this just keeps the table from growing forever.
export async function pruneOldSessions() {
  try {
    await pool.query('DELETE FROM sessions WHERE created_at < NOW() - INTERVAL 30 DAY');
  } catch (err) {
    console.error('pruneOldSessions failed:', err);
  }
}
