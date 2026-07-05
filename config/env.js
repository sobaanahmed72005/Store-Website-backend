import dotenv from 'dotenv';

dotenv.config();

// Single source of truth for every environment variable this backend reads.
// Add new variables here (with their default, if any) instead of reading
// process.env directly elsewhere — that's the one place to change later.

export const NODE_ENV = process.env.NODE_ENV || 'development';
export const IS_PRODUCTION = NODE_ENV === 'production';

export const PORT = process.env.PORT || 5000;
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

// Encrypts payment gateway (Safepay) and courier API credentials at rest in the database.
export const CREDENTIALS_ENCRYPTION_KEY = process.env.CREDENTIALS_ENCRYPTION_KEY;

// Seeded store admin account (only used if the account doesn't already exist).
export const ADMIN_NAME = process.env.ADMIN_NAME || 'Store Admin';
export const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

// Outgoing email (SMTP). Leave SMTP_HOST unset to log emails to the console instead of sending.
export const SMTP_HOST = process.env.SMTP_HOST;
export const SMTP_PORT = process.env.SMTP_PORT;
export const SMTP_USER = process.env.SMTP_USER;
export const SMTP_PASS = process.env.SMTP_PASS;
export const SMTP_FROM = process.env.SMTP_FROM || 'YourITstore <no-reply@youritstore.com>';
