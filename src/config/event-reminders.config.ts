const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

function envFlag(name: string, defaultValue = false): boolean {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim().toLowerCase();
  if (trueValues.has(normalized)) {
    return true;
  }
  if (falseValues.has(normalized)) {
    return false;
  }

  return defaultValue;
}

export function isEventRemindersEnabled(): boolean {
  return envFlag('EVENT_REMINDERS_ENABLED', false);
}

const DEFAULT_CLEANUP_CRON = '0 4 * * *'; // daily at 04:00 UTC
const DEFAULT_RETENTION_DAYS = 30;

export function getEventRemindersCleanupCron(): string {
  const raw = process.env.EVENT_REMINDERS_CLEANUP_CRON_SCHEDULE?.trim();
  return raw && raw.length > 0 ? raw : DEFAULT_CLEANUP_CRON;
}

export function getEventRemindersRetentionDays(): number {
  const raw = process.env.EVENT_REMINDERS_RETENTION_DAYS?.trim();
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_RETENTION_DAYS;
  }
  return Math.floor(parsed);
}
