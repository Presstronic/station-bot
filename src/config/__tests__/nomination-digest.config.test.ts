import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  getNominationDigestConfig,
  isNominationDigestEnabled,
  validateNominationDigestConfig,
} from '../nomination-digest.config.js';

const VARS = [
  'NOMINATION_DIGEST_ENABLED',
  'NOMINATION_DIGEST_CHANNEL_ID',
  'NOMINATION_DIGEST_ROLE_ID',
  'NOMINATION_DIGEST_CRON_SCHEDULE',
] as const;

type EnvSnapshot = Partial<Record<(typeof VARS)[number], string>>;

let snapshot: EnvSnapshot;

beforeEach(() => {
  snapshot = {};
  for (const key of VARS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of VARS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
});

describe('isNominationDigestEnabled', () => {
  it('defaults to false when unset', () => {
    expect(isNominationDigestEnabled()).toBe(false);
  });

  it('accepts truthy variants', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      process.env.NOMINATION_DIGEST_ENABLED = value;
      expect(isNominationDigestEnabled()).toBe(true);
    }
  });

  it('accepts falsy variants', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
      process.env.NOMINATION_DIGEST_ENABLED = value;
      expect(isNominationDigestEnabled()).toBe(false);
    }
  });
});

describe('getNominationDigestConfig', () => {
  it('returns defaults when vars are unset', () => {
    expect(getNominationDigestConfig()).toEqual({
      channelId: '',
      roleId: '',
      cronSchedule: '0 9 * * *',
    });
  });

  it('returns trimmed configured values', () => {
    process.env.NOMINATION_DIGEST_CHANNEL_ID = '  channel-123  ';
    process.env.NOMINATION_DIGEST_ROLE_ID = '  role-456  ';
    process.env.NOMINATION_DIGEST_CRON_SCHEDULE = '  15 8 * * *  ';

    expect(getNominationDigestConfig()).toEqual({
      channelId: 'channel-123',
      roleId: 'role-456',
      cronSchedule: '15 8 * * *',
    });
  });

  it('falls back to the default cron when the env var is blank', () => {
    process.env.NOMINATION_DIGEST_CRON_SCHEDULE = '   ';

    expect(getNominationDigestConfig().cronSchedule).toBe('0 9 * * *');
  });
});

describe('validateNominationDigestConfig', () => {
  it('returns no errors when the feature flag is off', () => {
    expect(validateNominationDigestConfig()).toEqual([]);
  });

  it('returns errors for missing channel and role when enabled', () => {
    process.env.NOMINATION_DIGEST_ENABLED = 'true';

    expect(validateNominationDigestConfig()).toEqual([
      'NOMINATION_DIGEST_CHANNEL_ID is required when NOMINATION_DIGEST_ENABLED=true',
      'NOMINATION_DIGEST_ROLE_ID is required when NOMINATION_DIGEST_ENABLED=true',
    ]);
  });

  it('returns no errors when enabled and fully configured', () => {
    process.env.NOMINATION_DIGEST_ENABLED = 'true';
    process.env.NOMINATION_DIGEST_CHANNEL_ID = 'channel-123';
    process.env.NOMINATION_DIGEST_ROLE_ID = 'role-456';

    expect(validateNominationDigestConfig()).toEqual([]);
  });
});
