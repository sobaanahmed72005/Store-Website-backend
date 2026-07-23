import jwt from 'jsonwebtoken';
import { AUTH_COOKIE, ADMIN_AUTH_COOKIE } from '../utils/authCookies.js';
import { JWT_SECRET, FRONTEND_URL } from '../config/env.js';
import { isSessionRevoked } from '../utils/sessionRevocation.js';

const FRONTEND_ORIGIN = new URL(FRONTEND_URL);

// CORS in app.js already blocks a cross-origin browser from reading the response to a
// credentialed fetch() — but that's the only thing standing between this API and CSRF today
// (there's no separate CSRF token, and it's not a deliberate design as much as an accident of the
// current body-parser configuration; see docs/AUDIT.md). A cookie-carrying request can still be
// *sent* cross-site (e.g. a classic HTML form submit) even when the response can't be read, so
// this checks the request actually claims to originate from the frontend before trusting the
// cookie on it, as a second, explicit layer rather than relying on that being incidentally true.
// Only enforced when the browser actually sends Origin/Referer — same-origin non-browser clients
// (server-to-server, curl) send neither, so this doesn't apply to them.
function hasUntrustedOrigin(req) {
  const origin = req.headers.origin || req.headers.referer;
  if (!origin) return false;
  try {
    const url = new URL(origin);
    if (url.protocol !== FRONTEND_ORIGIN.protocol || url.port !== FRONTEND_ORIGIN.port) return true;
    return url.hostname !== FRONTEND_ORIGIN.hostname && !url.hostname.endsWith(`.${FRONTEND_ORIGIN.hostname}`);
  } catch {
    return true;
  }
}

// Builds an auth middleware bound to one specific cookie — never both. Storefront and admin panel
// are the same origin/SPA, so a browser can legitimately be carrying a valid customer cookie *and*
// a valid admin cookie at the same time (someone signed into both in different tabs); each surface
// must only ever look at its own cookie, or the two identities bleed into each other exactly like
// they used to when both logins shared one cookie pair (see utils/authCookies.js).
function buildAuthMiddleware(cookieName) {
  return async function requireAuthWithCookie(req, res, next) {
    const token = req.cookies?.[cookieName];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    if (hasUntrustedOrigin(req)) return res.status(403).json({ error: 'Request origin not allowed' });

    try {
      const payload = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
      if (!req.business || payload.business_id !== req.business.id) {
        return res.status(401).json({ error: 'Invalid token for this store' });
      }
      // The JWT's own signature/expiry says this access token is still valid, but that alone
      // can't reflect a logout/password-change/2FA-disable that happened since it was issued —
      // this in-memory check is what makes revocation take effect immediately instead of waiting
      // out the token's remaining 15-minute lifetime (see utils/sessionRevocation.js).
      if (isSessionRevoked(payload.session_id)) {
        return res.status(401).json({ error: 'Session revoked', code: 'SESSION_REVOKED' });
      }
      req.user = payload;
      req.sessionId = payload.session_id;
      next();
    } catch (err) {
      // A distinct code for expiry (vs. a tampered/malformed token) lets the frontend tell the
      // difference between "call /auth/refresh to get a new access token" and "send the user
      // back to sign-in" — access tokens are expected to expire every 15 minutes by design.
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Access token expired', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
  };
}

// Storefront session only — can never see or be satisfied by an admin cookie.
export const requireAuth = buildAuthMiddleware(AUTH_COOKIE);

// Admin-panel session only — can never see or be satisfied by a customer cookie. The role check
// is defense-in-depth (this cookie should only ever hold an admin-role token, since only
// adminLogin/adminRefresh ever write to it) rather than the primary control.
const requireAdminCookie = buildAuthMiddleware(ADMIN_AUTH_COOKIE);
export function requireAdmin(req, res, next) {
  requireAdminCookie(req, res, () => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  });
}

// Storefront-only actions (placing an order, wishlist, writing a review) must never succeed
// under an admin's identity. requireAuth already can't see the admin cookie at all, but this
// role check stays as a second layer in case that ever changes.
export function requireCustomer(req, res, next) {
  requireAuth(req, res, () => {
    if (req.user.role !== 'customer') return res.status(403).json({ error: 'Customer account required' });
    next();
  });
}

// Accepts either a matching customer session (self) or an admin session (support/back-office
// access to any account). Checks the admin cookie first: if present, that request is understood
// as "admin acting", regardless of whether a customer cookie also happens to be sitting in the
// same browser — mirrors the admin's existing unconditional ability to view any user's data,
// just re-pointed at the now-separate admin cookie instead of a shared one.
export function requireSelfOrAdmin(paramName) {
  return (req, res, next) => {
    if (req.cookies?.[ADMIN_AUTH_COOKIE]) return requireAdmin(req, res, next);
    return requireAuth(req, res, () => {
      if (String(req.user.id) === String(req.params[paramName])) return next();
      return res.status(403).json({ error: 'Forbidden' });
    });
  };
}

// Like requireSelfOrAdmin, but for routes with no :userId param to check self-ownership against
// up front — ownership there is data-dependent (e.g. "whose order is this payment proof for?"),
// so the route just needs *an* identity, admin or customer, and leaves the actual admin-or-owner
// decision to the controller. Same admin-cookie-first precedence as requireSelfOrAdmin.
export function requireAnyAuth(req, res, next) {
  if (req.cookies?.[ADMIN_AUTH_COOKIE]) return requireAdmin(req, res, next);
  return requireAuth(req, res, next);
}

// Like requireSelfOrAdmin, but for storefront actions that only ever make sense for the caller's
// own account (e.g. writing your own cart) — unlike requireSelfOrAdmin, an admin session is NOT
// accepted here even as a self-match, since an admin has no legitimate cart of their own and this
// is exactly the gap that let a stray admin session write/checkout under the admin's account.
export function requireSelfCustomer(paramName) {
  return (req, res, next) => {
    requireAuth(req, res, () => {
      if (req.user.role === 'customer' && String(req.user.id) === String(req.params[paramName])) return next();
      return res.status(403).json({ error: 'Forbidden' });
    });
  };
}
