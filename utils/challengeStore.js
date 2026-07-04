import crypto from 'crypto';

const TTL_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 5;

// A short-lived, in-process record of a password-verified login pending its 2FA step. Deliberately
// separate from the real session JWT — a challenge id proves "you just entered the right password"
// but grants no API access, so leaking one is far less costly than leaking a session cookie.
export function createChallengeStore() {
  const challenges = new Map();

  function create(payload) {
    const id = crypto.randomBytes(24).toString('hex');
    challenges.set(id, { ...payload, attempts: 0, expiresAt: Date.now() + TTL_MS });
    return id;
  }

  function get(id) {
    const entry = challenges.get(id);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      challenges.delete(id);
      return null;
    }
    return entry;
  }

  function recordFailure(id) {
    const entry = challenges.get(id);
    if (!entry) return;
    entry.attempts += 1;
    if (entry.attempts >= MAX_ATTEMPTS) challenges.delete(id);
  }

  function consume(id) {
    challenges.delete(id);
  }

  return { create, get, recordFailure, consume };
}
