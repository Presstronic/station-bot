import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOW = '2024-06-01T00:00:00.000Z';

function makeConfigRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    guild_id:                          'guild-1',
    verification_enabled:              true,
    verified_role_name:                'Verified',
    temp_member_role_name:             'Temporary Member',
    potential_applicant_role_name:     'Potential Applicant',
    org_member_role_id:                null,
    org_member_role_name:              null,
    nomination_digest_enabled:         false,
    nomination_digest_channel_id:      null,
    nomination_digest_role_id:         null,
    nomination_digest_cron_schedule:   '0 9 * * *',
    manufacturing_enabled:             false,
    manufacturing_forum_channel_id:    null,
    manufacturing_staff_channel_id:    null,
    manufacturing_role_id:             null,
    manufacturing_create_order_thread_id: null,
    manufacturing_order_limit:         5,
    manufacturing_max_items_per_order: 10,
    manufacturing_order_rate_limit_per_5min: 1,
    manufacturing_order_rate_limit_per_hour: 5,
    manufacturing_create_order_post_title:   '📋 Create Order',
    manufacturing_create_order_post_message: 'Click the button below to submit a new manufacturing order.',
    manufacturing_keepalive_cron_schedule:   '0 6 * * *',
    purge_jobs_enabled:              false,
    temp_member_hours_to_expire:     48,
    temp_member_purge_cron_schedule: '0 3 * * *',
    birthday_enabled:       false,
    birthday_channel_id:    null,
    birthday_cron_schedule: '0 12 * * *',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeWithClient(querySpy: jest.Mock) {
  return jest.fn(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) =>
    fn({ query: querySpy }),
  );
}

function queryCalls(spy: jest.Mock): string[] {
  return (spy.mock.calls as [string, ...unknown[]][]).map((c) => String(c[0]));
}

// ---------------------------------------------------------------------------
// getGuildConfig
// ---------------------------------------------------------------------------

describe('getGuildConfig', () => {
  it('returns a mapped GuildConfig when a row exists', async () => {
    const row = makeConfigRow({
      org_member_role_id:           'role-123',
      nomination_digest_enabled:    true,
      nomination_digest_channel_id: 'chan-456',
    });
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { getGuildConfig } = await import('../guild-config.repository.js');
    const result = await getGuildConfig('guild-1');

    expect(result).not.toBeNull();
    expect(result!.guildId).toBe('guild-1');
    expect(result!.orgMemberRoleId).toBe('role-123');
    expect(result!.nominationDigestEnabled).toBe(true);
    expect(result!.nominationDigestChannelId).toBe('chan-456');
    expect(result!.manufacturingOrderLimit).toBe(5);
    expect(result!.orgMemberRoleName).toBeNull();
    expect(result!.birthdayChannelId).toBeNull();
  });

  it('returns null when no row exists', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { getGuildConfig } = await import('../guild-config.repository.js');
    expect(await getGuildConfig('unknown-guild')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// upsertGuildConfig
// ---------------------------------------------------------------------------

describe('upsertGuildConfig', () => {
  it('inserts a new row with defaults when no patch fields are provided', async () => {
    const row = makeConfigRow();
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { upsertGuildConfig } = await import('../guild-config.repository.js');
    const result = await upsertGuildConfig('guild-1', {});

    expect(result.guildId).toBe('guild-1');
    const [sql] = queryCalls(query);
    expect(sql).toMatch(/INSERT INTO guild_configs/i);
    expect(sql).toMatch(/ON CONFLICT/i);
  });

  it('includes only patched columns in the INSERT and SET clauses', async () => {
    const row = makeConfigRow({ nomination_digest_enabled: true, nomination_digest_channel_id: 'chan-1' });
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { upsertGuildConfig } = await import('../guild-config.repository.js');
    const result = await upsertGuildConfig('guild-1', {
      nominationDigestEnabled: true,
      nominationDigestChannelId: 'chan-1',
    });

    expect(result.nominationDigestEnabled).toBe(true);
    expect(result.nominationDigestChannelId).toBe('chan-1');

    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]];
    expect(sql).toMatch(/nomination_digest_enabled/);
    expect(sql).toMatch(/nomination_digest_channel_id/);
    expect(sql).not.toMatch(/manufacturing_enabled/);
    expect(params).toContain(true);
    expect(params).toContain('chan-1');
  });

  it('updates an existing row on conflict and returns the updated config', async () => {
    const row = makeConfigRow({ verified_role_name: 'Member' });
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { upsertGuildConfig } = await import('../guild-config.repository.js');
    const result = await upsertGuildConfig('guild-1', { verifiedRoleName: 'Member' });

    expect(result.verifiedRoleName).toBe('Member');
    const [sql] = queryCalls(query);
    expect(sql).toMatch(/DO UPDATE SET/i);
    expect(sql).toMatch(/verified_role_name/);
  });

  it('does not include unpatched columns in the SET clause', async () => {
    const row = makeConfigRow({ purge_jobs_enabled: true });
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { upsertGuildConfig } = await import('../guild-config.repository.js');
    await upsertGuildConfig('guild-1', { purgeJobsEnabled: true });

    const [sql] = queryCalls(query);
    expect(sql).toMatch(/purge_jobs_enabled/);
    expect(sql).not.toMatch(/verified_role_name/);
    expect(sql).not.toMatch(/manufacturing_enabled/);
  });
});

// ---------------------------------------------------------------------------
// getAllGuildConfigs
// ---------------------------------------------------------------------------

describe('getAllGuildConfigs', () => {
  it('returns all rows as GuildConfig[]', async () => {
    const row1 = makeConfigRow({ guild_id: 'guild-1' });
    const row2 = makeConfigRow({ guild_id: 'guild-2', verification_enabled: false });
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [row1, row2] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { getAllGuildConfigs } = await import('../guild-config.repository.js');
    const results = await getAllGuildConfigs();

    expect(results).toHaveLength(2);
    expect(results[0].guildId).toBe('guild-1');
    expect(results[1].guildId).toBe('guild-2');
    expect(results[1].verificationEnabled).toBe(false);
  });

  it('returns an empty array when no rows exist', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { getAllGuildConfigs } = await import('../guild-config.repository.js');
    expect(await getAllGuildConfigs()).toEqual([]);
  });
});
