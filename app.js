import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import pinoHttp from 'pino-http';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

import { logger } from './utils/logger.js';
import { Sentry } from './utils/sentry.js';
import { isDbError } from './utils/dbErrors.js';
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
import { requireCloudflare } from './middleware/cloudflare.js';
import { getRobotsTxt, getSitemap } from './controllers/seoController.js';
import { FRONTEND_URL, NODE_ENV } from './config/env.js';

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
// Cloudflare sits in front of Railway's own proxy in production, so there are two hops between
// the real client and this process, not one — trust proxy is set high enough to make Express's
// own req.protocol/req.hostname resolution correct through both, but req.ip itself is
// overridden more precisely below (requireCloudflare, from CF-Connecting-IP) rather than relying
// on hop-counting alone, since that silently breaks again the moment either provider's edge
// topology changes. `2` trusts exactly those two hops, unlike `true`, which would trust the
// whole header and let a client spoof it.
app.set('trust proxy', 2);
// Logs one structured line per request on completion (method, url, status, response time,
// request id) — the request id also shows up in req.log's output below, so a specific request's
// completion line and any error it logged along the way can be correlated in the log stream.
// Health checks are excluded since they're polled on an interval and would otherwise dominate
// the log volume with routine 200s.
app.use(pinoHttp({
  logger,
  autoLogging: { ignore: (req) => req.url === '/api/health' },
  // Without this, pino-http's default req serializer logs the raw headers object verbatim —
  // including Cookie, which carries the live access/refresh session tokens (see
  // utils/authCookies.js). Anyone with read access to shipped logs could otherwise hijack any
  // logged-in user's session straight out of the log stream.
  redact: {
    paths: ['req.headers.cookie', 'req.headers.authorization', 'res.headers["set-cookie"]'],
    censor: '[redacted]',
  },
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

// Railway's own container healthcheck (see Dockerfile) hits this directly, bypassing Cloudflare
// — so it must stay reachable before requireCloudflare below, not after.
app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// Verifies every other request actually passed through Cloudflare (see middleware/cloudflare.js)
// before anything downstream trusts CF-Connecting-IP for rate-limit keys or audit logs.
app.use(requireCloudflare);

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
// Express identifies error-handling middleware by arity (exactly 4 params) — dropping the unused
// `next` below would silently turn this into a normal middleware that Express never routes
// errors to.
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // Multer's own errors (file too large, too many files, etc.) are routine, expected 4xx cases —
  // same treatment as the hand-written err.status = 400 rejections in middleware/upload.js's
  // fileFilter — not the generic 500 they'd otherwise fall through to.
  if (err instanceof multer.MulterError) {
    err.status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
  }
  // req.log (from pino-http above) is already bound to this request's id, so this line and the
  // request's own completion line end up correlated in the log stream. business/userId aren't
  // things pino-http could know about on its own, so they're added explicitly here.
  (req.log || logger).error(
    { err, method: req.method, url: req.originalUrl, business: req.business?.slug, userId: req.user?.id },
    'Request failed'
  );
  // Only truly unexpected errors go to Sentry — a handful of routes deliberately throw with
  // err.status set for routine, expected 4xx cases (e.g. a CORS rejection), and those shouldn't
  // page anyone. Everything without an explicit status (or a genuine 5xx) is a real bug.
  if (!err.status || err.status >= 500) {
    Sentry.captureException(err);
  }
  // mysql2 sets sqlMessage/sqlState on raw DB-driver errors, which can echo back schema/query
  // details — mask those in production. Connection-level failures (pool can't reach the DB at
  // all) don't set those fields but carry a Node `err.code` whose message embeds the host/port
  // (e.g. "connect ECONNREFUSED 127.0.0.1:3306"), so those are masked too. Every other thrown
  // error in this codebase (validation, CORS, integration failures like "Leopards is not
  // enabled") is a hand-written message that's always meant to reach the client, so it's left
  // alone. Defaults to masking (not showing) when NODE_ENV is simply unset, rather than assuming
  // a platform sets it correctly.
  const showDetail = !isDbError(err) || NODE_ENV === 'development';
  res.status(err.status || 500).json({ error: showDetail ? (err.message || 'Internal server error') : 'Internal server error' });
});

export default app;
