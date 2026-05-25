import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isEventRemindersEnabled } from '../event-reminders.config.js';

const VARS = ['EVENT_REMINDERS_ENABLED'] as const;

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
