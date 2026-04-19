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

export interface NominationDigestConfig {
  channelId: string;
  roleId: string;
  cronSchedule: string;
}

export function isNominationDigestEnabled(): boolean {
  return envFlag('NOMINATION_DIGEST_ENABLED', false);
}

export function getNominationDigestConfig(): NominationDigestConfig {
  return {
    channelId: (process.env.NOMINATION_DIGEST_CHANNEL_ID ?? '').trim(),
    roleId: (process.env.NOMINATION_DIGEST_ROLE_ID ?? '').trim(),
    cronSchedule: process.env.NOMINATION_DIGEST_CRON_SCHEDULE?.trim() || '0 9 * * *',
  };
}

export function validateNominationDigestConfig(): string[] {
  if (!isNominationDigestEnabled()) {
    return [];
  }

  const config = getNominationDigestConfig();
  const errors: string[] = [];

  if (!config.channelId) {
    errors.push('NOMINATION_DIGEST_CHANNEL_ID is required when NOMINATION_DIGEST_ENABLED=true');
  }

  if (!config.roleId) {
    errors.push('NOMINATION_DIGEST_ROLE_ID is required when NOMINATION_DIGEST_ENABLED=true');
  }

  return errors;
}
