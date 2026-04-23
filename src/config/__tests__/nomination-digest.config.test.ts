import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isNominationDigestEnabled } from '../nomination-digest.config.js';

const VARS = ['NOMINATION_DIGEST_ENABLED'] as const;

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
