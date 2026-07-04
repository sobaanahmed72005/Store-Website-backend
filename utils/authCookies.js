const isProd = process.env.NODE_ENV === 'production';

export const AUTH_COOKIE = 'cz_token';

// Same-site subdomains share a registrable domain, so Lax is delivered on the
// cross-origin XHR/fetch calls this app makes between a store subdomain and the API,
// while still being withheld from requests originating on a genuinely different site.
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: isProd,
  sameSite: 'lax',
  path: '/',
};

export function setAuthCookie(res, name, token) {
  res.cookie(name, token, { ...COOKIE_OPTIONS, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

export function clearAuthCookie(res, name) {
  res.clearCookie(name, COOKIE_OPTIONS);
}
