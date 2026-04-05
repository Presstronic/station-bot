import { afterEach, describe, expect, it } from '@jest/globals';
import { isReadOnlyMode, isPurgeJobsEnabled, verifySessionTtlMinutes } from '../runtime-flags.js';

const originalReadOnlyMode = process.env.BOT_READ_ONLY_MODE;
const originalPurgeJobsEnabled = process.env.PURGE_JOBS_ENABLED;
const originalVerifySessionTtl = process.env.VERIFY_SESSION_TTL_MINUTES;

afterEach(() => {
  if (originalReadOnlyMode === undefined) {
    delete process.env.BOT_READ_ONLY_MODE;
  } else {
    process.env.BOT_READ_ONLY_MODE = originalReadOnlyMode;
  }
  if (originalPurgeJobsEnabled === undefined) {
    delete process.env.PURGE_JOBS_ENABLED;
  } else {
    process.env.PURGE_JOBS_ENABLED = originalPurgeJobsEnabled;
  }
  if (originalVerifySessionTtl === undefined) {
    delete process.env.VERIFY_SESSION_TTL_MINUTES;
  } else {
    process.env.VERIFY_SESSION_TTL_MINUTES = originalVerifySessionTtl;
  }
});

describe('isReadOnlyMode', () => {
  it('defaults to true when env var is not set', () => {
    delete process.env.BOT_READ_ONLY_MODE;
    expect(isReadOnlyMode()).toBe(true);
  });

  it('returns false when BOT_READ_ONLY_MODE is false', () => {
    process.env.BOT_READ_ONLY_MODE = 'false';
    expect(isReadOnlyMode()).toBe(false);
  });

  it('accepts truthy env variants', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      process.env.BOT_READ_ONLY_MODE = value;
      expect(isReadOnlyMode()).toBe(true);
    }
  });

  it('accepts explicit false env variants', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
      process.env.BOT_READ_ONLY_MODE = value;
      expect(isReadOnlyMode()).toBe(false);
    }
  });

  it('falls back to default for unrecognized values', () => {
    process.env.BOT_READ_ONLY_MODE = 'enabled';
    expect(isReadOnlyMode()).toBe(true);
  });
});

describe('verifySessionTtlMinutes', () => {
  it('defaults to 15 when env var is not set', () => {
    delete process.env.VERIFY_SESSION_TTL_MINUTES;
    expect(verifySessionTtlMinutes()).toBe(15);
  });

  it('returns the configured value when VERIFY_SESSION_TTL_MINUTES is set', () => {
    process.env.VERIFY_SESSION_TTL_MINUTES = '30';
    expect(verifySessionTtlMinutes()).toBe(30);
  });

  it('falls back to default for non-positive or non-integer values', () => {
    for (const value of ['0', '-5', 'abc', '1.5']) {
      process.env.VERIFY_SESSION_TTL_MINUTES = value;
      expect(verifySessionTtlMinutes()).toBe(15);
    }
  });
});

describe('isPurgeJobsEnabled', () => {
  it('defaults to false when env var is not set', () => {
    delete process.env.PURGE_JOBS_ENABLED;
    expect(isPurgeJobsEnabled()).toBe(false);
  });

  it('returns true when PURGE_JOBS_ENABLED is true', () => {
    process.env.PURGE_JOBS_ENABLED = 'true';
    expect(isPurgeJobsEnabled()).toBe(true);
  });

  it('returns false when PURGE_JOBS_ENABLED is false', () => {
    process.env.PURGE_JOBS_ENABLED = 'false';
    expect(isPurgeJobsEnabled()).toBe(false);
  });
});
