import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './utils/logger.js';
import pool from './config/db.js';
import categoriesRouter from './routes/categories.js';
import productsRouter from './routes/products.js';
import authRouter from './routes/auth.js';
import cartRouter from './routes/cart.js';
import ordersRouter from './routes/orders.js';
import adminRouter from './routes/admin.js';
import contentRouter from './routes/content.js';
import wishlistRouter from './routes/wishlist.js';
import reviewsRouter from './routes/reviews.js';
import currencyRouter from './routes/currency.js';
import discountCodesRouter from './routes/discountCodes.js';
import newsletterRouter from './routes/newsletter.js';
import contactRouter from './routes/contact.js';
import { resolveBusiness } from './middleware/tenant.js';
import { getRobotsTxt, getSitemap } from './controllers/seoController.js';
import { sendReviewReminders } from './utils/reviewReminder.js';
import { syncLeopardsTracking } from './utils/leopardsSync.js';
import { pruneOldSessions } from './utils/sessions.js';
import { PORT, FRONTEND_URL, NODE_ENV } from './config/env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ORIGIN = new URL(FRONTEND_URL);

// Every store is served from a subdomain of the same base host (see middleware/tenant.js), so
// allowing that host and its subdomains covers the whole multi-tenant frontend without resorting
// to a wildcard origin (which `cors` also rejects once `credentials: true` is set). Scheme and
// port must match too, not just hostname — cookies are domain-scoped but not port-scoped, so
// matching on hostname alone would let anything else bound to the same host (e.g. any other
// process listening on localhost during local dev, on any port) pass this check and receive
// credentialed cross-origin responses.
function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== FRONTEND_ORIGIN.protocol || url.port !== FRONTEND_ORIGIN.port) return false;
    return url.hostname === FRONTEND_ORIGIN.hostname || url.hostname.endsWith(`.${FRONTEND_ORIGIN.hostname}`);
  } catch {
    return false;
  }
}

const app = express();
// Railway (see CORS comment below) puts exactly one reverse proxy in front of this process, so
// req.ip and the rate limiters below (which key on it) need to read the client's real IP from
// the one X-Forwarded-For hop that proxy sets, not fall back to the proxy's own IP for every
// request — which is what happens with trust proxy left at its default of disabled, and would
// collapse every real client behind it into a single shared rate-limit bucket. `1` trusts only
// that one hop, unlike `true`, which would trust the whole header and let a client spoof it.
app.set('trust proxy', 1);
// Logs one structured line per request on completion (method, url, status, response time,
// request id) — the request id also shows up in req.log's output below, so a specific request's
// completion line and any error it logged along the way can be correlated in the log stream.
// Health checks are excluded since they're polled on an interval and would otherwise dominate
// the log volume with routine 200s.
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
}));
app.use(helmet({
  // Uploaded product images are loaded cross-origin (<img>) from store subdomains, and this
  // server has no HTML views of its own for CSP to protect.
  contentSecurityPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));
app.use(cors({
  origin: (origin, callback) => {
    if (isAllowedOrigin(origin)) return callback(null, true);
    const err = new Error('Not allowed by CORS');
    err.status = 403;
    callback(err);
  },
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Crawlers fetch these at the storefront's own root, not under /api — resolved per-tenant by hostname.
app.get('/robots.txt', resolveBusiness, getRobotsTxt);
app.get('/sitemap.xml', resolveBusiness, getSitemap);

app.use('/api', resolveBusiness);

app.use('/api/categories', categoriesRouter);
app.use('/api/products', productsRouter);
app.use('/api/auth', authRouter);
app.use('/api/cart', cartRouter);
app.use('/api/orders', ordersRouter);
app.use('/api/admin', adminRouter);
app.use('/api/content', contentRouter);
app.use('/api/wishlist', wishlistRouter);
app.use('/api/reviews', reviewsRouter);
app.use('/api/currency', currencyRouter);
app.use('/api/discount-codes', discountCodesRouter);
app.use('/api/newsletter', newsletterRouter);
app.use('/api/contact', contactRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// This is where most controller errors actually land, not a fallback for the rare case — most
// route handlers have no try/catch at all and rely on Express 5 auto-forwarding a rejected
// async handler's promise straight here. A controller only adds its own try/catch when it needs
// to translate one *specific, expected* failure into a friendlier response than this handler's
// generic one — e.g. catching err.code === 'ER_DUP_ENTRY' on an insert that can hit a unique
// constraint, to return "that code already exists" instead of a raw 500 — and re-throws
// (`throw err`) anything else so it still reaches here. If you're adding a new insert/update
// that can hit a real DB constraint under normal use (not just "in theory"), catch that specific
// error code the same way; don't reach for a blanket try/catch around DB calls that can't
// otherwise fail.
app.use((err, req, res, next) => {
  // req.log (from pino-http above) is already bound to this request's id, so this line and the
  // request's own completion line end up correlated in the log stream. business/userId aren't
  // things pino-http could know about on its own, so they're added explicitly here.
  (req.log || logger).error(
    { err, method: req.method, url: req.originalUrl, business: req.business?.slug, userId: req.user?.id },
    'Request failed'
  );
  // mysql2 sets sqlMessage/sqlState on raw DB-driver errors, which can echo back schema/query
  // details — mask those in production. Every other thrown error in this codebase (validation,
  // CORS, integration failures like "Leopards is not enabled") is a hand-written message that's
  // always meant to reach the client, so it's left alone. Defaults to masking (not showing) when
  // NODE_ENV is simply unset, rather than assuming a platform sets it correctly.
  const isDbError = Boolean(err.sqlMessage || err.sqlState);
  const showDetail = !isDbError || NODE_ENV === 'development';
  res.status(err.status || 500).json({ error: showDetail ? (err.message || 'Internal server error') : 'Internal server error' });
});

process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});
process.on('unhandledRejection', (err) => {
  logger.fatal({ err }, 'Unhandled rejection');
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
