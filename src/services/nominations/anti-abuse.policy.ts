import type { NominationRatePolicy } from './types.ts';

const DEFAULT_USER_COOLDOWN_SECONDS = 60;
const DEFAULT_TARGET_MAX_PER_DAY = 0;
const DEFAULT_USER_MAX_PER_DAY = 0;

function parseNonNegativeInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
}

export function getNominationRatePolicy(): NominationRatePolicy {
  return {
    userCooldownSeconds: parseNonNegativeInt('NOMINATION_USER_COOLDOWN_SECONDS', DEFAULT_USER_COOLDOWN_SECONDS),
    targetMaxPerDay:     parseNonNegativeInt('NOMINATION_TARGET_MAX_PER_DAY',    DEFAULT_TARGET_MAX_PER_DAY),
    userMaxPerDay:       parseNonNegativeInt('NOMINATION_USER_MAX_PER_DAY',       DEFAULT_USER_MAX_PER_DAY),
  };
}
