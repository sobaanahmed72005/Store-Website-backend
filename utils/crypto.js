import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const raw = process.env.CREDENTIALS_ENCRYPTION_KEY;
  if (!raw) throw new Error('CREDENTIALS_ENCRYPTION_KEY is not set — required to store/read payment and courier API credentials');
  const key = Buffer.from(raw, 'hex');
  if (key.length !== 32) throw new Error('CREDENTIALS_ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  return key;
}

// Encrypts a secret (Safepay/courier API keys) for storage at rest. Format: iv:authTag:ciphertext (all hex).
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
  } catch {
    return null;
  }
}
