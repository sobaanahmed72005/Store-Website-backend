import { IS_PRODUCTION } from '../config/env.js';

// Customer session (storefront). Unchanged names — existing customer sessions survive this
// file's admin/customer split without being forced to re-authenticate.
export const AUTH_COOKIE = 'cz_token';
export const REFRESH_COOKIE = 'cz_refresh';

// Admin session (admin panel). Deliberately a *separate* cookie pair, not just a separate JWT
// payload — storefront and admin panel are the same origin/SPA, so any cookie set with path '/'
// is sent on every request regardless of which page/tab triggered it. When admin and customer
// logins shared one cookie pair, the browser only ever had one login "slot" for the whole site:
// logging into the admin panel overwrote the customer's cookie (and vice versa), so the two
// sessions silently logged each other out, and a storefront tab could pick up and act on an
// admin's identity. Giving each surface its own cookie pair makes that impossible structurally —
// requireAuth (customer) and requireAdmin (admin, see middleware/auth.js) each read only their
// own pair, so the two sessions can coexist in the same browser without ever seeing or clobbering
// each other.
export const ADMIN_AUTH_COOKIE = 'cz_admin_token';
export const ADMIN_REFRESH_COOKIE = 'cz_admin_refresh';

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

function cookieNamesForRole(role) {
  return role === 'admin'
    ? { auth: ADMIN_AUTH_COOKIE, refresh: ADMIN_REFRESH_COOKIE }
    : { auth: AUTH_COOKIE, refresh: REFRESH_COOKIE };
}

export function setAuthCookies(res, accessToken, sessionId, role) {
  const { auth, refresh } = cookieNamesForRole(role);
  res.cookie(auth, accessToken, { ...COOKIE_OPTIONS, maxAge: ACCESS_TOKEN_MAX_AGE });
  res.cookie(refresh, sessionId, { ...COOKIE_OPTIONS, maxAge: REFRESH_TOKEN_MAX_AGE });
}

export function clearAuthCookies(res, role) {
  const { auth, refresh } = cookieNamesForRole(role);
  res.clearCookie(auth, COOKIE_OPTIONS);
  res.clearCookie(refresh, COOKIE_OPTIONS);
}
