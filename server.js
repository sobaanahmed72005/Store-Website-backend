import express from 'express';
import cors from 'cors';
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
import platformRouter from './routes/platform.js';
import safepayRouter from './routes/safepay.js';
import { resolveBusiness } from './middleware/tenant.js';
import { getRobotsTxt, getSitemap } from './controllers/seoController.js';
import { webhook as safepayWebhook } from './controllers/safepayController.js';
import { sendReviewReminders } from './utils/reviewReminder.js';
import { syncLeopardsTracking } from './utils/leopardsSync.js';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(cors());
// Capture raw body for Safepay webhook HMAC verification
app.use(express.json({
  verify: (_req, _res, buf) => { _req.rawBody = buf.toString(); },
}));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

// The platform panel manages businesses themselves, so it runs before any single business is resolved.
app.use('/api/platform', platformRouter);

// Crawlers fetch these at the storefront's own root, not under /api — resolved per-tenant by hostname.
app.get('/robots.txt', resolveBusiness, getRobotsTxt);
app.get('/sitemap.xml', resolveBusiness, getSitemap);

// Safepay webhook must be registered BEFORE resolveBusiness — Safepay won't include store context
app.post('/api/payments/safepay/webhook', safepayWebhook);

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
app.use('/api/payments/safepay', safepayRouter);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Backend API running on http://localhost:${PORT}`);
  setTimeout(sendReviewReminders, 10_000);
  setInterval(sendReviewReminders, 60 * 60 * 1000);
  setTimeout(syncLeopardsTracking, 20_000);
  setInterval(syncLeopardsTracking, 30 * 60 * 1000);
});
