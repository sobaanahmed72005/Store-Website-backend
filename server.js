import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

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

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_HOST = new URL(process.env.FRONTEND_URL || 'http://localhost:5173').hostname;

// Every store is served from a subdomain of the same base host (see middleware/tenant.js),
// so allowing that host and its subdomains covers the whole multi-tenant frontend without
// resorting to a wildcard origin (which `cors` also rejects once `credentials: true` is set).
function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const { hostname } = new URL(origin);
    return hostname === FRONTEND_HOST || hostname.endsWith(`.${FRONTEND_HOST}`);
  } catch {
    return false;
  }
}

const app = express();
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

app.use((err, req, res, next) => {
  console.error(err);
  // mysql2 sets sqlMessage/sqlState on raw DB-driver errors, which can echo back schema/query
  // details — mask those in production. Every other thrown error in this codebase (validation,
  // CORS, integration failures like "Leopards is not enabled") is a hand-written message that's
  // always meant to reach the client, so it's left alone. Defaults to masking (not showing) when
  // NODE_ENV is simply unset, rather than assuming a platform sets it correctly.
  const isDbError = Boolean(err.sqlMessage || err.sqlState);
  const showDetail = !isDbError || process.env.NODE_ENV === 'development';
  res.status(err.status || 500).json({ error: showDetail ? (err.message || 'Internal server error') : 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
  setTimeout(sendReviewReminders, 10_000);
  setInterval(sendReviewReminders, 60 * 60 * 1000);
  setTimeout(syncLeopardsTracking, 20_000);
  setInterval(syncLeopardsTracking, 30 * 60 * 1000);
  setTimeout(pruneOldSessions, 30_000);
  setInterval(pruneOldSessions, 24 * 60 * 60 * 1000);
});
