import crypto from 'crypto';
import { CLOUDFLARE_SHARED_SECRET, IS_PRODUCTION } from '../config/env.js';

// Cloudflare's Transform Rules reject setting any custom header starting with "X-CF-"/"CF-"
// (reserved for Cloudflare's own system headers like CF-Connecting-IP, CF-Ray), so the shared
// secret has to use a different prefix.
const SECRET_HEADER = 'x-origin-shared-secret';
const IP_HEADER = 'cf-connecting-ip';

function timingSafeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  // crypto.timingSafeEqual throws on mismatched lengths instead of just returning false — a
  // length check up front is fine to do in variable time, since the attacker already knows
  // their own guess's length; only the byte-by-byte match needs to be constant-time.
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// Verifies every request actually passed through Cloudflare before trusting its CF-Connecting-IP
// header for anything (rate-limit keys, audit logs) — see config/env.js for how the shared
// secret is provisioned. Without this, anyone who finds the raw Railway origin URL could send
// CF-Connecting-IP themselves and either dodge every IP-keyed rate limit (a fresh fake IP per
// request) or frame another visitor's IP in the audit log.
//
// Skipped entirely outside production so local dev/test — which has no Cloudflare in front of
// it — isn't blocked on configuring a secret that doesn't apply there.
export function requireCloudflare(req, res, next) {
  if (!IS_PRODUCTION) return next();

  const provided = req.headers[SECRET_HEADER];
  if (typeof provided !== 'string' || !timingSafeEqual(provided, CLOUDFLARE_SHARED_SECRET)) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  // req.ip is defined by Express as a getter-only property on the request prototype (see
  // node_modules/express/lib/request.js) — a plain `req.ip = cfIp` assignment throws under ES
  // modules' strict mode. Object.defineProperty on the instance shadows the prototype getter
  // instead, which every downstream `req.ip` read (rate limiters, utils/auditLog.js) picks up
  // transparently.
  const cfIp = req.headers[IP_HEADER];
  if (typeof cfIp === 'string' && cfIp) {
    Object.defineProperty(req, 'ip', { value: cfIp, configurable: true, enumerable: true });
  }

  next();
}
