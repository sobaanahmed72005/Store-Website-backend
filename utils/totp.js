import { generateSecret, verify, generateURI } from 'otplib';
import QRCode from 'qrcode';
import crypto from 'crypto';

export function generateTotpSecret() {
  return generateSecret();
}

// Tolerates 1 step (30s) of clock drift on either side of the server's clock. `afterTimeStep`
// (when the caller has one on file) rejects a code that already matched at or before that step —
// closing the replay window on an otherwise-valid captured code, since a raw 6-digit code alone
// carries no information about whether it's already been used. Callers persist the returned
// `timeStep` after a successful verification so the *next* call can pass it back in.
export async function verifyTotpToken(secret, token, afterTimeStep) {
  if (!secret || !token) return { valid: false };
  try {
    const result = await verify({ secret, token: String(token).trim(), epochTolerance: 1, afterTimeStep });
    return result?.valid ? { valid: true, timeStep: result.timeStep } : { valid: false };
  } catch {
    return { valid: false };
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
