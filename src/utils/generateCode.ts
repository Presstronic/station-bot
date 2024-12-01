// src/utils/generateCode.ts

import crypto from 'crypto';

export function generateVerificationCode(): string {
  return crypto.randomBytes(8).toString('hex');
}
