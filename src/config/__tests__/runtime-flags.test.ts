import { afterEach, describe, expect, it } from '@jest/globals';
import { isReadOnlyMode } from '../runtime-flags.ts';

const originalReadOnlyMode = process.env.BOT_READ_ONLY_MODE;

afterEach(() => {
  if (originalReadOnlyMode === undefined) {
    delete process.env.BOT_READ_ONLY_MODE;
  } else {
    process.env.BOT_READ_ONLY_MODE = originalReadOnlyMode;
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
