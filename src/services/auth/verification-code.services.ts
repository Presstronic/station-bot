// src/utils/generateCode.ts

import crypto from 'crypto';

export function generateDrdntVerificationCode(): string {
  return "DRDNT-" + generateVerificationCode();
}

export function generateVerificationCode(): string {
  return crypto.randomBytes(8).toString('hex');
}
