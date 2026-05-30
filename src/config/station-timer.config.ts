const trueValues = new Set(['1', 'true', 'yes', 'on']);
const falseValues = new Set(['0', 'false', 'no', 'off']);

export const STATION_TIMER_DEFAULT_MINUTES = 30;
export const STATION_TIMER_MAX_ACTIVE_PER_GUILD_DEFAULT = 30;
export const STATION_TIMER_MAX_ACTIVE_PER_USER_DEFAULT = 5;
export const STATION_TIMER_POLL_CRON_DEFAULT = '*/1 * * * *';

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

function envPositiveInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const parsed = Number(raw.trim());
  return Number.isInteger(parsed) && parsed > 0 ? parsed : defaultValue;
}

function envCron(name: string, defaultValue: string): string {
  const raw = process.env[name];
  if (!raw) {
    return defaultValue;
  }

  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : defaultValue;
}

export function isStationTimerEnabled(): boolean {
  return envFlag('STATION_TIMER_ENABLED', false);
}

export function stationTimerMaxActivePerGuild(): number {
  return envPositiveInt('STATION_TIMER_MAX_ACTIVE_PER_GUILD', STATION_TIMER_MAX_ACTIVE_PER_GUILD_DEFAULT);
}

export function stationTimerMaxActivePerUser(): number {
  return envPositiveInt('STATION_TIMER_MAX_ACTIVE_PER_USER', STATION_TIMER_MAX_ACTIVE_PER_USER_DEFAULT);
}

export function stationTimerPollCron(): string {
  return envCron('STATION_TIMER_POLL_CRON', STATION_TIMER_POLL_CRON_DEFAULT);
}
