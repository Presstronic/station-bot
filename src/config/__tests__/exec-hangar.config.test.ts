import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isExecHangarEnabled } from '../exec-hangar.config.js';

const VARS = ['EXEC_HANGAR_ENABLED'] as const;

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

describe('isExecHangarEnabled', () => {
  it('defaults to false when unset', () => {
    expect(isExecHangarEnabled()).toBe(false);
  });

  it('accepts truthy variants', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      process.env.EXEC_HANGAR_ENABLED = value;
      expect(isExecHangarEnabled()).toBe(true);
    }
  });

  it('accepts falsy variants', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
      process.env.EXEC_HANGAR_ENABLED = value;
      expect(isExecHangarEnabled()).toBe(false);
    }
  });
});
