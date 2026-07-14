import app from './app.js';
import { logger } from './utils/logger.js';
import { Sentry } from './utils/sentry.js';
import pool from './config/db.js';
import { sendReviewReminders } from './utils/reviewReminder.js';
import { syncLeopardsTracking } from './utils/leopardsSync.js';
import { pruneOldSessions } from './utils/sessions.js';
import { PORT } from './config/env.js';

// process.exit() below is synchronous and immediate — without flushing first, Sentry's async
// network send for this exact event (the one telling us the process is about to die) would very
// often lose the race and never actually reach Sentry.
process.on('uncaughtException', async (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  Sentry.captureException(err);
  await Sentry.flush(2000).catch(() => {});
  process.exit(1);
});
process.on('unhandledRejection', async (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
  Sentry.captureException(err);
  await Sentry.flush(2000).catch(() => {});
  process.exit(1);
});

const server = app.listen(PORT, () => {
  logger.info(`Backend API running on http://localhost:${PORT}`);
});

const timeouts = [
  setTimeout(sendReviewReminders, 10_000),
  setTimeout(syncLeopardsTracking, 20_000),
  setTimeout(pruneOldSessions, 30_000),
];
const intervals = [
  setInterval(sendReviewReminders, 60 * 60 * 1000),
  setInterval(syncLeopardsTracking, 30 * 60 * 1000),
  setInterval(pruneOldSessions, 24 * 60 * 60 * 1000),
];

// A deploy sends SIGTERM and expects the process to exit on its own shortly after — without
// this, the default behavior is to die immediately, cutting off whatever request or DB query
// happened to be in flight at that instant instead of letting it finish. server.close() stops
// accepting *new* connections but lets already-open ones complete first; only once that's done
// (or SHUTDOWN_TIMEOUT_MS passes, in case something's stuck) do we close the DB pool and exit.
const SHUTDOWN_TIMEOUT_MS = 15_000;
let shuttingDown = false;

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down gracefully');

  timeouts.forEach(clearTimeout);
  intervals.forEach(clearInterval);

  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);

  server.close(async (err) => {
    if (err) logger.error({ err }, 'Error while closing HTTP server');
    try {
      await pool.end();
    } catch (err) {
      logger.error({ err }, 'Error while closing DB pool');
    }
    clearTimeout(forceExit);
    process.exit(err ? 1 : 0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
