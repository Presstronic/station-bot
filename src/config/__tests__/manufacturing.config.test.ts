import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  isManufacturingEnabled,
  getManufacturingConfig,
  validateManufacturingConfig,
} from '../manufacturing.config.js';

const VARS = [
  'MANUFACTURING_ENABLED',
  'MANUFACTURING_FORUM_CHANNEL_ID',
  'MANUFACTURING_ROLE_ID',
  'ORGANIZATION_MEMBER_ROLE_ID',
  'MANUFACTURING_ORDER_LIMIT',
  'MANUFACTURING_MAX_ITEMS_PER_ORDER',
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

// ---------------------------------------------------------------------------
// isManufacturingEnabled
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// getManufacturingConfig
// ---------------------------------------------------------------------------
describe('getManufacturingConfig', () => {
  it('returns empty strings for missing required vars', () => {
    const config = getManufacturingConfig();
    expect(config.forumChannelId).toBe('');
    expect(config.manufacturingRoleId).toBe('');
    expect(config.orgMemberRoleId).toBe('');
  });

  it('returns configured values when set', () => {
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    process.env.MANUFACTURING_ROLE_ID = 'role-456';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-789';

    const config = getManufacturingConfig();
    expect(config.forumChannelId).toBe('forum-123');
    expect(config.manufacturingRoleId).toBe('role-456');
    expect(config.orgMemberRoleId).toBe('org-789');
  });

  it('uses default orderLimit of 5 when not set', () => {
    expect(getManufacturingConfig().orderLimit).toBe(5);
  });

  it('uses default maxItemsPerOrder of 10 when not set', () => {
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(10);
  });

  it('parses custom orderLimit', () => {
    process.env.MANUFACTURING_ORDER_LIMIT = '3';
    expect(getManufacturingConfig().orderLimit).toBe(3);
  });

  it('parses custom maxItemsPerOrder', () => {
    process.env.MANUFACTURING_MAX_ITEMS_PER_ORDER = '7';
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(7);
  });

  it('falls back to default for non-numeric orderLimit', () => {
    process.env.MANUFACTURING_ORDER_LIMIT = 'lots';
    expect(getManufacturingConfig().orderLimit).toBe(5);
  });

  it('falls back to default for zero or negative maxItemsPerOrder', () => {
    process.env.MANUFACTURING_MAX_ITEMS_PER_ORDER = '0';
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(10);
  });
});

// ---------------------------------------------------------------------------
// validateManufacturingConfig
// ---------------------------------------------------------------------------
describe('validateManufacturingConfig', () => {
  it('returns empty array when feature is disabled', () => {
    process.env.MANUFACTURING_ENABLED = 'false';
    expect(validateManufacturingConfig()).toEqual([]);
  });

  it('returns errors for all missing required vars when enabled', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    const errors = validateManufacturingConfig();
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => e.includes('MANUFACTURING_FORUM_CHANNEL_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('MANUFACTURING_ROLE_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('ORGANIZATION_MEMBER_ROLE_ID'))).toBe(true);
  });

  it('returns no errors when all required vars are set', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    process.env.MANUFACTURING_ROLE_ID = 'role-456';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-789';
    expect(validateManufacturingConfig()).toEqual([]);
  });

  it('returns only the missing var errors when partially configured', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    const errors = validateManufacturingConfig();
    expect(errors).toHaveLength(2);
    expect(errors.some((e) => e.includes('MANUFACTURING_ROLE_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('ORGANIZATION_MEMBER_ROLE_ID'))).toBe(true);
  });

  it('skips validation when env var is not set (defaults to disabled)', () => {
    // MANUFACTURING_ENABLED not set — defaults to false, so validation should be skipped
    expect(validateManufacturingConfig()).toEqual([]);
  });
});
