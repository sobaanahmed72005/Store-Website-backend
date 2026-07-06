import dotenv from 'dotenv';

dotenv.config();

// Single source of truth for every environment variable this backend reads.
// Add new variables here instead of reading process.env directly elsewhere —
// that's the one place to change later.

// Every one of these must be set explicitly — no built-in defaults. A missing
// value fails loudly and clearly at startup instead of silently degrading
// (wrong CORS origin, emails logged instead of sent, made-up currency rates, etc.)
// once the app is already running.
const REQUIRED_VARS = [
  'NODE_ENV',
  'PORT',
  'FRONTEND_URL',
  'BACKEND_URL',
  'ADMIN_PATH',
  'DB_HOST',
  'DB_PORT',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'JWT_SECRET',
  'CREDENTIALS_ENCRYPTION_KEY',
  'SMTP_HOST',
  'SMTP_PORT',
  'SMTP_USER',
  'SMTP_PASS',
  'SMTP_FROM',
];

const missing = REQUIRED_VARS.filter((key) => !process.env[key]);
if (missing.length > 0) {
  throw new Error(`Missing required environment variable(s): ${missing.join(', ')}. Set them in backend/.env.`);
}

export const NODE_ENV = process.env.NODE_ENV;

export const PORT = process.env.PORT;

// The CORS allowlist in server.js trusts requests whose origin matches this exactly (scheme +
// host + port).
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const BACKEND_URL = process.env.BACKEND_URL;

// Obfuscated admin panel path — must match VITE_ADMIN_PATH in the root .env (src/config/adminPath.js).
export const ADMIN_PATH = process.env.ADMIN_PATH;

// Single-store deployments set this so tenant resolution doesn't depend on guessing the
// slug from the request's hostname (see middleware/tenant.js). Left unset for multi-tenant
// deployments — that's a real feature toggle, not a fallback.
export const DEFAULT_STORE_SLUG = process.env.DEFAULT_STORE_SLUG;

export const DB_CONFIG = {
  HOST: process.env.DB_HOST,
  PORT: process.env.DB_PORT,
  USER: process.env.DB_USER,
  PASSWORD: process.env.DB_PASSWORD,
  NAME: process.env.DB_NAME,
};

export const JWT_SECRET = process.env.JWT_SECRET;

// Encrypts payment gateway (Safepay) and courier API credentials at rest in the database.
export const CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;

// Seeded store admin account. Only used by sql/init.js, and only if the account doesn't
// already exist — left unset, the seed step is skipped rather than required.
export const ADMIN_NAME = process.env.ADMIN_NAME;
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Outgoing email (SMTP).
export const SMTP_CONFIG = {
  HOST: process.env.SMTP_HOST,
  PORT: process.env.SMTP_PORT,
  USER: process.env.SMTP_USER,
  PASS: process.env.SMTP_PASS,
  FROM: process.env.SMTP_FROM,
};
