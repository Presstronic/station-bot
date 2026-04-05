const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

function envInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const normalizedRaw = raw.trim();
  const parsed = Number(normalizedRaw);
  return Number.isFinite(parsed) && Number.isInteger(parsed) && parsed > 0
    ? parsed
    : defaultValue;
}

function envFlag(name: string, defaultValue = false): boolean {
  const rawValue = process.env[name];
  if (!rawValue) {
    return defaultValue;
  }

  const normalizedValue = rawValue.trim().toLowerCase();

  if (trueValues.has(normalizedValue)) {
    return true;
  }

  if (falseValues.has(normalizedValue)) {
    return false;
  }

  return defaultValue;
}

export function isReadOnlyMode(): boolean {
  return envFlag('BOT_READ_ONLY_MODE', true);
}

export function isVerificationEnabled(): boolean {
  return envFlag('VERIFICATION_ENABLED', true);
}

export function isPurgeJobsEnabled(): boolean {
  return envFlag('PURGE_JOBS_ENABLED', false);
}

export function verifyRateLimitPerMinute(): number {
  return envInt('VERIFY_RATE_LIMIT_PER_MINUTE', 1);
}

export function verifyRateLimitPerHour(): number {
  return envInt('VERIFY_RATE_LIMIT_PER_HOUR', 10);
}

export function rsiHttpTimeoutMs(): number {
  return envInt('RSI_HTTP_TIMEOUT_MS', 12_000);
}
