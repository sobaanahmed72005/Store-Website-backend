import { IS_PRODUCTION } from '../config/env.js';

export const AUTH_COOKIE = 'cz_token';
export const REFRESH_COOKIE = 'cz_refresh';

// Access token: short-lived, decoded on every request with no DB lookup (see middleware/auth.js)
// — its own expiry is what bounds how long a stolen/leaked token stays useful. Exported so
// authController.js can derive the JWT's expiresIn and the expiry it reports to the frontend
// from this single constant instead of hardcoding it a second time.
export const ACCESS_TOKEN_MAX_AGE = 15 * 60 * 1000;

// Refresh token: just the session's id (see utils/sessions.js) — an unguessable random value
// that's revocable server-side. Its lifetime is how long a user can stay signed in without
// re-entering a password, as long as the session hasn't been revoked (logout, password change,
// 2FA disable).
const REFRESH_TOKEN_MAX_AGE = 7 * 24 * 60 * 60 * 1000;

// The frontend and API can end up on domains that aren't same-site to each other (e.g.
// separate Railway-issued preview domains, or yourdomain.com vs a different apex for the
// API) — SameSite=Lax withholds cookies from those cross-site fetch() calls entirely. None
// is safe here because the CORS allowlist in server.js already restricts which origins can
// get a credentialed response back, so this doesn't open the cookie up to arbitrary sites.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: IS_PRODUCTION,
  sameSite: IS_PRODUCTION ? 'none' : 'lax',
  path: '/',
};

export function setAuthCookies(res, accessToken, sessionId) {
  res.cookie(AUTH_COOKIE, accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_MAX_AGE });
  res.cookie(REFRESH_COOKIE, sessionId, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_MAX_AGE });
}

export function clearAuthCookies(res) {
  res.clearCookie(AUTH_COOKIE, COOKIE_OPTIONS);
  res.clearCookie(REFRESH_COOKIE, COOKIE_OPTIONS);
}
