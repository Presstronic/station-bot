import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  isEventRemindersEnabled,
  getEventRemindersCleanupCron,
  getEventRemindersRetentionDays,
} from '../event-reminders.config.js';

const VARS = [
  'EVENT_REMINDERS_ENABLED',
  'EVENT_REMINDERS_CLEANUP_CRON_SCHEDULE',
  'EVENT_REMINDERS_RETENTION_DAYS',
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

describe('isEventRemindersEnabled', () => {
  it('defaults to false when unset', () => {
    expect(isEventRemindersEnabled()).toBe(false);
  });

  it('accepts truthy variants', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      process.env.EVENT_REMINDERS_ENABLED = value;
      expect(isEventRemindersEnabled()).toBe(true);
    }
  });

  it('accepts falsy variants', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
      process.env.EVENT_REMINDERS_ENABLED = value;
      expect(isEventRemindersEnabled()).toBe(false);
    }
  });
});

describe('getEventRemindersCleanupCron', () => {
  it('defaults to 0 4 * * * (daily at 04:00 UTC) when unset', () => {
    expect(getEventRemindersCleanupCron()).toBe('0 4 * * *');
  });

  it('returns the env value when set', () => {
    process.env.EVENT_REMINDERS_CLEANUP_CRON_SCHEDULE = '0 5 * * *';
    expect(getEventRemindersCleanupCron()).toBe('0 5 * * *');
  });

  it('falls back to default when env value is blank', () => {
    process.env.EVENT_REMINDERS_CLEANUP_CRON_SCHEDULE = '   ';
    expect(getEventRemindersCleanupCron()).toBe('0 4 * * *');
  });
});

describe('getEventRemindersRetentionDays', () => {
  it('defaults to 30 when unset', () => {
    expect(getEventRemindersRetentionDays()).toBe(30);
  });

  it('parses positive integers', () => {
    process.env.EVENT_REMINDERS_RETENTION_DAYS = '60';
    expect(getEventRemindersRetentionDays()).toBe(60);
  });

  it('falls back to default on zero, negative, or non-numeric values', () => {
    for (const value of ['0', '-5', 'abc', '']) {
      process.env.EVENT_REMINDERS_RETENTION_DAYS = value;
      expect(getEventRemindersRetentionDays()).toBe(30);
    }
  });

  it('floors fractional values', () => {
    process.env.EVENT_REMINDERS_RETENTION_DAYS = '14.7';
    expect(getEventRemindersRetentionDays()).toBe(14);
  });
});
