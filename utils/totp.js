import { generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';

export function generateTotpSecret() {
  return generateSecret();
}

// Tolerates 1 step (30s) of clock drift on either side of the server's clock.
export async function verifyTotpToken(secret, token) {
  if (!secret || !token) return false;
  try {
    const result = await verify({ secret, token: String(token).trim(), epochTolerance: 1 });
    return Boolean(result?.valid);
  } catch {
    return false;
  }
}

export function buildOtpAuthQrCode(accountLabel, secret, issuer) {
  const otpauth = generateURI({ strategy: 'totp', issuer, label: accountLabel, secret });
  return QRCode.toDataURL(otpauth);
}

// Human-typeable single-use codes for when the authenticator device is unavailable.
export function generateRecoveryCodes(count = 8) {
  return Array.from({ length: count }, () => {
    const raw = crypto.randomBytes(5).toString('hex').toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}
