import crypto from 'crypto';

export function generateDrdntVerificationCode(): string {
  return "DRDNT-" + generateVerificationCode();
}

/**
 * Generates a cryptographically secure 16-character lowercase hex token.
 *
 * Entropy source: `crypto.randomBytes(8)` — 64 bits from the OS CSPRNG.
 * Output format:  16 characters, a-f and 0-9 only.
 *
 * Used as the suffix of DRDNT- verification codes and as standalone
 * verification tokens where a short, high-entropy string is required.
 */
export function generateVerificationCode(): string {
  return crypto.randomBytes(8).toString('hex');
}
