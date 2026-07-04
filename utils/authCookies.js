const isProd = process.env.NODE_ENV === 'production';

export const AUTH_COOKIE = 'cz_token';

// The frontend and API can end up on domains that aren't same-site to each other (e.g.
// separate Railway-issued preview domains, or yourdomain.com vs a different apex for the
// API) — SameSite=Lax withholds cookies from those cross-site fetch() calls entirely. None
// is safe here because the CORS allowlist in server.js already restricts which origins can
// get a credentialed response back, so this doesn't open the cookie up to arbitrary sites.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: isProd ? 'none' : 'lax',
  path: '/',
};

export function setAuthCookie(res, name, token) {
  res.cookie(name, token, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookie(res, name) {
  res.clearCookie(name, COOKIE_OPTIONS);
}
