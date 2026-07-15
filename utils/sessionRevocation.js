// In-memory per-process revoked-session cache, checked on every authenticated request so a
// logged-out (or password-changed / 2FA-disabled) access token stops working immediately
// instead of remaining valid for up to its full 15-minute lifetime — closing the gap documented
// in sessions.js/authController.js without adding a DB round-trip to every request. Same
// single-process tradeoff already made in loginRateLimit.js: this needs to move to a shared
// store (e.g. Redis) if this app is ever run as more than one Node process behind a load
// balancer, since each process would otherwise have its own, unsynced revocation list.
const revoked = new Map(); // sessionId -> expiresAt (ms)

// Access tokens live for 15 minutes (see issueSession in authController.js) — past that point
// the JWT is already invalid on expiry grounds alone, so there's no need to remember the
// revocation any longer than that.
const TTL_MS = 15 * 60 * 1000;

export function markSessionRevoked(sessionId) {
  revoked.set(sessionId, Date.now() + TTL_MS);
}

export function isSessionRevoked(sessionId) {
  const expiresAt = revoked.get(sessionId);
  if (expiresAt === undefined) return false;
  if (expiresAt <= Date.now()) {
    revoked.delete(sessionId);
    return false;
  }
  return true;
}

// isSessionRevoked's lazy delete only cleans up entries that get looked up again, which isn't
// guaranteed for every revoked session — this sweep keeps the map from growing unbounded under
// sustained logout traffic.
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, expiresAt] of revoked) {
    if (expiresAt <= now) revoked.delete(sessionId);
  }
}, 5 * 60 * 1000).unref();
