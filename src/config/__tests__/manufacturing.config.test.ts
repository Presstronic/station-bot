import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { isManufacturingEnabled } from '../manufacturing.config.js';

const VARS = ['MANUFACTURING_ENABLED'] as const;

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

describe('isManufacturingEnabled', () => {
  it('defaults to false when env var is not set', () => {
    expect(isManufacturingEnabled()).toBe(false);
  });

  it('returns false when MANUFACTURING_ENABLED=false', () => {
    process.env.MANUFACTURING_ENABLED = 'false';
    expect(isManufacturingEnabled()).toBe(false);
  });

  it('accepts truthy variants', () => {
    for (const value of ['1', 'true', 'yes', 'on']) {
      process.env.MANUFACTURING_ENABLED = value;
      expect(isManufacturingEnabled()).toBe(true);
    }
  });

  it('accepts falsy variants', () => {
    for (const value of ['0', 'false', 'no', 'off']) {
      process.env.MANUFACTURING_ENABLED = value;
      expect(isManufacturingEnabled()).toBe(false);
    }
  });

  it('falls back to default (false) for unrecognised values', () => {
    process.env.MANUFACTURING_ENABLED = 'maybe';
    expect(isManufacturingEnabled()).toBe(false);
  });
});
