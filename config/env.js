import dotenv from 'dotenv';

dotenv.config();

// Single source of truth for every environment variable this backend reads.
// Add new variables here (with their default, if any) instead of reading
// process.env directly elsewhere — that's the one place to change later.

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const PORT = process.env.PORT || 5000;

// The CORS allowlist in server.js trusts requests whose origin matches this exactly (scheme +
// host + port). Falling back to the local dev default in production would silently reject every
// real request instead of failing loudly, so it's required there.
if (IS_PRODUCTION && !process.env.FRONTEND_URL) {
  throw new Error('FRONTEND_URL must be set when NODE_ENV=production.');
}
export const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
export const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${PORT}`;

// Obfuscated admin panel path — must match VITE_ADMIN_PATH in the root .env (src/config/adminPath.js).
export const ADMIN_PATH = process.env.ADMIN_PATH || '/mgmt-8f2k1c';

// Single-store deployments set this so tenant resolution doesn't depend on guessing the
// slug from the request's hostname (see middleware/tenant.js).
export const DEFAULT_STORE_SLUG = process.env.DEFAULT_STORE_SLUG || null;

export const DB_HOST = process.env.DB_HOST;
export const DB_PORT = process.env.DB_PORT;
export const DB_USER = process.env.DB_USER;
export const DB_PASSWORD = process.env.DB_PASSWORD;
export const DB_NAME = process.env.DB_NAME;

export const JWT_SECRET = process.env.JWT_SECRET;

// Every session token (15-minute access + 7-day refresh session id signing) depends entirely on
// this secret's unpredictability — a short or guessable value is offline-crackable (HS256 is
// just HMAC-SHA256) and would let an attacker forge a token for any user, including admin. This
// only checks length/charset variety as a floor, not real entropy, but it catches the realistic
// failure mode: someone pastes "changeme" or a short placeholder and it silently works forever.
function assertStrongSecret(name, value, minLength) {
  if (!IS_PRODUCTION) return; // don't block local dev/test on this — .env.example ships no secrets
  if (!value || value.length < minLength) {
    throw new Error(`${name} must be set to a random value of at least ${minLength} characters in production (see .env.example for how to generate one).`);
  }
}
assertStrongSecret('JWT_SECRET', JWT_SECRET, 32);

// Encrypts courier API credentials and 2FA TOTP secrets at rest in the database (see
// controllers/courierController.js, controllers/authController.js). There's no payment gateway
// integration in this codebase to encrypt credentials for — orders.safepay_token in schema.sql is
// an intentionally-kept-but-unused leftover from one that was removed.
export const CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;
if (IS_PRODUCTION && CREDENTIALS_ENCRYPTION_KEY && !/^[0-9a-f]{64}$/i.test(CREDENTIALS_ENCRYPTION_KEY)) {
  throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes) — see .env.example for how to generate one.');
}

// Seeded store admin account (only used if the account doesn't already exist).
export const ADMIN_NAME = process.env.ADMIN_NAME || 'Store Admin';
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Outgoing email (SMTP). Leave SMTP_HOST unset to log emails to the console instead of sending.
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = process.env.SMTP_PORT;
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const SMTP_FROM = process.env.SMTP_FROM || 'Store <no-reply@example.com>';

// Error tracking (https://sentry.io). Leave unset to disable — errors are still logged locally
// either way (see utils/logger.js), this just adds off-process alerting/aggregation on top.
export const SENTRY_DSN = process.env.SENTRY_DSN || null;
