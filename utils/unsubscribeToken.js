import { createHmac, timingSafeEqual } from 'crypto';
import { JWT_SECRET } from '../config/env.js';
import { buildStoreUrl } from './storeUrl.js';

if (!JWT_SECRET) {
  throw new Error('JWT_SECRET must be set — refusing to sign unsubscribe tokens with a default secret.');
}
const SECRET = JWT_SECRET;

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

export function buildUnsubscribeUrl(business, email) {
  const token = generateUnsubscribeToken(business.id, email);
  return `${buildStoreUrl(business.slug)}/unsubscribe?email=${encodeURIComponent(email)}&token=${token}`;
}
