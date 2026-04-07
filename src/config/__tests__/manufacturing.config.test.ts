import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  isManufacturingEnabled,
  getManufacturingConfig,
  validateManufacturingConfig,
} from '../manufacturing.config.js';

const VARS = [
  'MANUFACTURING_ENABLED',
  'MANUFACTURING_FORUM_CHANNEL_ID',
  'MANUFACTURING_STAFF_CHANNEL_ID',
  'MANUFACTURING_ROLE_ID',
  'ORGANIZATION_MEMBER_ROLE_ID',
  'MANUFACTURING_ORDER_LIMIT',
  'MANUFACTURING_MAX_ITEMS_PER_ORDER',
  'ORDER_RATE_LIMIT_PER_5MIN',
  'ORDER_RATE_LIMIT_PER_HOUR',
  'MANUFACTURING_CREATE_ORDER_POST_TITLE',
  'MANUFACTURING_CREATE_ORDER_POST_MESSAGE',
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
    expect(config.staffChannelId).toBe('');
    expect(config.manufacturingRoleId).toBe('');
    expect(config.organizationMemberRoleId).toBe('');
  });

  it('returns configured values when set', () => {
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = 'staff-456';
    process.env.MANUFACTURING_ROLE_ID = 'role-456';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-789';

    const config = getManufacturingConfig();
    expect(config.forumChannelId).toBe('forum-123');
    expect(config.staffChannelId).toBe('staff-456');
    expect(config.manufacturingRoleId).toBe('role-456');
    expect(config.organizationMemberRoleId).toBe('org-789');
  });

  it('trims whitespace from ID values', () => {
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = '  forum-123  ';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = '  staff-456  ';
    process.env.MANUFACTURING_ROLE_ID = '  role-456  ';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = '  org-789  ';

    const config = getManufacturingConfig();
    expect(config.forumChannelId).toBe('forum-123');
    expect(config.staffChannelId).toBe('staff-456');
    expect(config.manufacturingRoleId).toBe('role-456');
    expect(config.organizationMemberRoleId).toBe('org-789');
  });

  it('uses default orderLimit of 5 when not set', () => {
    expect(getManufacturingConfig().orderLimit).toBe(5);
  });

  it('uses default maxItemsPerOrder of 10 when not set', () => {
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(10);
  });

  it('uses default orderRateLimitPer5Min of 1 when not set', () => {
    expect(getManufacturingConfig().orderRateLimitPer5Min).toBe(1);
  });

  it('uses default orderRateLimitPerHour of 5 when not set', () => {
    expect(getManufacturingConfig().orderRateLimitPerHour).toBe(5);
  });

  it('parses custom orderLimit', () => {
    process.env.MANUFACTURING_ORDER_LIMIT = '3';
    expect(getManufacturingConfig().orderLimit).toBe(3);
  });

  it('parses custom maxItemsPerOrder', () => {
    process.env.MANUFACTURING_MAX_ITEMS_PER_ORDER = '7';
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(7);
  });

  it('parses custom ORDER_RATE_LIMIT_PER_5MIN', () => {
    process.env.ORDER_RATE_LIMIT_PER_5MIN = '3';
    expect(getManufacturingConfig().orderRateLimitPer5Min).toBe(3);
  });

  it('parses custom ORDER_RATE_LIMIT_PER_HOUR', () => {
    process.env.ORDER_RATE_LIMIT_PER_HOUR = '10';
    expect(getManufacturingConfig().orderRateLimitPerHour).toBe(10);
  });

  it('falls back to default for non-numeric orderLimit', () => {
    process.env.MANUFACTURING_ORDER_LIMIT = 'lots';
    expect(getManufacturingConfig().orderLimit).toBe(5);
  });

  it('falls back to default for zero or negative maxItemsPerOrder', () => {
    process.env.MANUFACTURING_MAX_ITEMS_PER_ORDER = '0';
    expect(getManufacturingConfig().maxItemsPerOrder).toBe(10);
  });

  it('falls back to default for zero or negative ORDER_RATE_LIMIT_PER_5MIN', () => {
    for (const value of ['0', '-1']) {
      process.env.ORDER_RATE_LIMIT_PER_5MIN = value;
      expect(getManufacturingConfig().orderRateLimitPer5Min).toBe(1);
    }
  });

  it('falls back to default for zero or negative ORDER_RATE_LIMIT_PER_HOUR', () => {
    for (const value of ['0', '-1']) {
      process.env.ORDER_RATE_LIMIT_PER_HOUR = value;
      expect(getManufacturingConfig().orderRateLimitPerHour).toBe(5);
    }
  });

  it('uses default createOrderPostTitle when env var is not set', () => {
    expect(getManufacturingConfig().createOrderPostTitle).toBe('📋 Create Order');
  });

  it('uses custom createOrderPostTitle when env var is set', () => {
    process.env.MANUFACTURING_CREATE_ORDER_POST_TITLE = '🛠️ Place Your Order';
    expect(getManufacturingConfig().createOrderPostTitle).toBe('🛠️ Place Your Order');
  });

  it('trims whitespace from createOrderPostTitle', () => {
    process.env.MANUFACTURING_CREATE_ORDER_POST_TITLE = '  My Title  ';
    expect(getManufacturingConfig().createOrderPostTitle).toBe('My Title');
  });

  it('uses default createOrderPostMessage when env var is not set', () => {
    expect(getManufacturingConfig().createOrderPostMessage).toBe(
      'Click the button below to submit a new manufacturing order.',
    );
  });

  it('uses custom createOrderPostMessage when env var is set', () => {
    process.env.MANUFACTURING_CREATE_ORDER_POST_MESSAGE = 'Hit the button to get started.';
    expect(getManufacturingConfig().createOrderPostMessage).toBe('Hit the button to get started.');
  });

  it('trims whitespace from createOrderPostMessage', () => {
    process.env.MANUFACTURING_CREATE_ORDER_POST_MESSAGE = '  My message  ';
    expect(getManufacturingConfig().createOrderPostMessage).toBe('My message');
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
    expect(errors).toHaveLength(4);
    expect(errors.some((e) => e.includes('MANUFACTURING_FORUM_CHANNEL_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('MANUFACTURING_STAFF_CHANNEL_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('MANUFACTURING_ROLE_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('ORGANIZATION_MEMBER_ROLE_ID'))).toBe(true);
  });

  it('returns no errors when all required vars are set', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = 'staff-456';
    process.env.MANUFACTURING_ROLE_ID = 'role-456';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-789';
    expect(validateManufacturingConfig()).toEqual([]);
  });

  it('treats whitespace-only required vars as missing when enabled', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = '   ';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = '   ';
    process.env.MANUFACTURING_ROLE_ID = '   ';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = '   ';

    const errors = validateManufacturingConfig();
    expect(errors).toHaveLength(4);
    expect(errors.some((e) => e.includes('MANUFACTURING_FORUM_CHANNEL_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('MANUFACTURING_STAFF_CHANNEL_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('MANUFACTURING_ROLE_ID'))).toBe(true);
    expect(errors.some((e) => e.includes('ORGANIZATION_MEMBER_ROLE_ID'))).toBe(true);
  });

  it('returns an error when forum and staff channel IDs are the same', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'channel-123';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = 'channel-123';
    process.env.MANUFACTURING_ROLE_ID = 'role-456';
    process.env.ORGANIZATION_MEMBER_ROLE_ID = 'org-789';
    const errors = validateManufacturingConfig();
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/must be different channels/);
  });

  it('returns only the missing var errors when partially configured', () => {
    process.env.MANUFACTURING_ENABLED = 'true';
    process.env.MANUFACTURING_FORUM_CHANNEL_ID = 'forum-123';
    process.env.MANUFACTURING_STAFF_CHANNEL_ID = 'staff-456';
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
