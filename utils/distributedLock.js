import pool from '../config/db.js';
import { logger } from './logger.js';

// Scheduled jobs (server.js) run on a plain setInterval per process, with no coordination
// between instances. That's harmless today (single process), but the moment this app is scaled
// to more than one instance behind a load balancer — the normal response to more traffic — every
// instance would fire the same job on its own clock: duplicate review-reminder emails to the
// same customer, duplicate courier API calls, etc.
//
// MySQL's GET_LOCK()/RELEASE_LOCK() give us a zero-new-infrastructure mutex: it's scoped to the
// connection that acquired it (held for the duration of the job here) and is automatically freed
// if that connection ever drops, so a crashed instance can never leave the lock stuck. `0` as the
// timeout means "try once, don't block" — if another instance already holds it, this run is
// simply skipped rather than queueing, which is exactly what we want for a job that's about to
// run again on its own schedule anyway.
export async function withDistributedLock(lockName, fn) {
  const connection = await pool.getConnection();
  try {
    const [[{ acquired }]] = await connection.query('SELECT GET_LOCK(?, 0) AS acquired', [lockName]);
    if (!acquired) {
      logger.debug({ lockName }, 'Skipping scheduled job — another instance already holds the lock');
      return;
    }
    try {
      await fn();
    } finally {
      await connection.query('SELECT RELEASE_LOCK(?)', [lockName]).catch((err) => {
        logger.error({ err, lockName }, 'Failed to release distributed lock');
      });
    }
  } finally {
    connection.release();
  }
}
