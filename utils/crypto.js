import crypto from 'crypto';
import { CREDENTIALS_ENCRYPTION_KEY } from '../config/env.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const raw = CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set — required to store/read payment and courier API credentials');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  return key;
}

// Encrypts a secret (payment gateway/courier API keys) for storage at rest. Format: iv:authTag:ciphertext (all hex).
export function encryptSecret(plainText) {
  if (plainText == null || plainText === '') return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSecret(stored) {
  if (!stored) return null;
  const parts = String(stored).split(':');
  if (parts.length !== 3) return null;
  const [ivHex, tagHex, dataHex] = parts;
  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
    const decrypted = Buffer.concat([decipher.update(Buffer.from(dataHex, 'hex')), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    // A well-formed stored value (iv:authTag:ciphertext, already checked above) that still fails
    // to decrypt/authenticate almost always means CREDENTIALS_ENCRYPTION_KEY has changed since
    // this value was encrypted — a bad rotation, or a value copied into an environment with a
    // different key — not "there's no secret here" (that's the `!stored` case above, which never
    // reaches this catch). Every caller already treats `null` as "no secret" and degrades
    // gracefully (2FA falls back to recovery codes, a payment/courier integration reports as
    // unconfigured), which is the right behavior either way — but silently doing that with no log
    // line means an operator has no way to notice a key rotation just broke every existing
    // encrypted secret until a user reports 2FA or checkout suddenly not working.
    logger.error({ err: err.message }, 'decryptSecret failed on a well-formed value — CREDENTIALS_ENCRYPTION_KEY likely changed since this value was encrypted');
    return null;
  }
}
