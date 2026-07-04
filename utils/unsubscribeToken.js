import { createHmac, timingSafeEqual } from 'crypto';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set — refusing to sign unsubscribe tokens with a default secret.');
}
const SECRET = process.env.JWT_SECRET;

// A stateless, unguessable per-(business, email) token — no separate DB column
// needed, and it's recomputed the same way every time so old email links never expire.
export function generateUnsubscribeToken(businessId, email) {
  return createHmac('sha256', SECRET).update(`${businessId}:${email.toLowerCase().trim()}`).digest('hex').slice(0, 32);
}

export function verifyUnsubscribeToken(businessId, email, token) {
  if (!token || typeof token !== 'string') return false;
  const expected = generateUnsubscribeToken(businessId, email);
  const a = Buffer.from(expected);
  const b = Buffer.from(token);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
