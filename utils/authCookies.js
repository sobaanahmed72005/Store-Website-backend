import { NODE_ENV } from '../config/env.js';

export const AUTH_COOKIE = 'cz_token';
export const REFRESH_COOKIE = 'cz_refresh';

// Access token: short-lived, decoded on every request with no DB lookup (see middleware/auth.js)
// — its own expiry is what bounds how long a stolen/leaked token stays useful.
const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000;

// Refresh token: a longer-lived signed JWT (see controllers/authController.js), used only to
// mint a new access token once the short one expires. Pure JWT auth — there's no server-side
// session store, so neither token can be revoked before it naturally expires. Logout, password
// change, and 2FA disable only clear/replace the cookies on the device making that request; a
// copy of either token elsewhere keeps working until its own expiry. Must match the refresh
// JWT's own `expiresIn` in authController.js — this is just how long the browser keeps the
// cookie around, not a separate expiry.
const REFRESH_TOKEN_MAX_AGE = 24 * 60 * 60 * 1000;

// The frontend and API can end up on domains that aren't same-site to each other (e.g.
// separate Railway-issued preview domains, or yourdomain.com vs a different apex for the
// API) — SameSite=Lax withholds cookies from those cross-site fetch() calls entirely. None
// is safe here because the CORS allowlist in server.js already restricts which origins can
// get a credentialed response back, so this doesn't open the cookie up to arbitrary sites.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: NODE_ENV === 'production',
  sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
  path: '/',
};

export function setAuthCookies(res, accessToken, refreshToken) {
  res.cookie(AUTH_COOKIE, accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_MAX_AGE });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_MAX_AGE });
}

export function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIE, COOKIE_OPTIONS);
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
}
