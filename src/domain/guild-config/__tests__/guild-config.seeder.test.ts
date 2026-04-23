import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  // Clean env before each test
  delete process.env.VERIFICATION_ENABLED;
  delete process.env.DEFAULT_ROLES;
  delete process.env.ORGANIZATION_MEMBER_ROLE_ID;
  delete process.env.ORGANIZATION_MEMBER_ROLE_NAME;
  delete process.env.NOMINATION_DIGEST_ENABLED;
  delete process.env.NOMINATION_DIGEST_CHANNEL_ID;
  delete process.env.NOMINATION_DIGEST_ROLE_ID;
  delete process.env.NOMINATION_DIGEST_CRON_SCHEDULE;
  delete process.env.MANUFACTURING_ENABLED;
  delete process.env.MANUFACTURING_FORUM_CHANNEL_ID;
  delete process.env.MANUFACTURING_STAFF_CHANNEL_ID;
  delete process.env.MANUFACTURING_ROLE_ID;
  delete process.env.MANUFACTURING_CREATE_ORDER_THREAD_ID;
  delete process.env.MANUFACTURING_ORDER_LIMIT;
  delete process.env.MANUFACTURING_MAX_ITEMS_PER_ORDER;
  delete process.env.ORDER_RATE_LIMIT_PER_5MIN;
  delete process.env.ORDER_RATE_LIMIT_PER_HOUR;
  delete process.env.MANUFACTURING_CREATE_ORDER_POST_TITLE;
  delete process.env.MANUFACTURING_CREATE_ORDER_POST_MESSAGE;
  delete process.env.MANUFACTURING_KEEPALIVE_CRON_SCHEDULE;
  delete process.env.PURGE_JOBS_ENABLED;
  delete process.env.TEMPORARY_MEMBER_PURGE_CRON_SCHEDULE;
  delete process.env.BIRTHDAY_ENABLED;
  delete process.env.BIRTHDAY_CHANNEL_ID;
});

function makeGuild(id: string, name: string) {
  return { id, name };
}

function makeClient(guilds: { id: string; name: string }[]) {
  return {
    guilds: {
      cache: {
        values: () => guilds[Symbol.iterator](),
      },
    },
  };
}

// ---------------------------------------------------------------------------
// seedGuildConfigsFromEnv
// ---------------------------------------------------------------------------

describe('seedGuildConfigsFromEnv', () => {
  it('seeds a guild with no existing row and calls upsertGuildConfig', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const upsertGuildConfig = jest.fn<() => Promise<object>>().mockResolvedValue({});

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    process.env.VERIFICATION_ENABLED = 'true';
    process.env.DEFAULT_ROLES = 'Member,Guest,Applicant';
    process.env.NOMINATION_DIGEST_ENABLED = 'true';
    process.env.NOMINATION_DIGEST_CHANNEL_ID = 'chan-123';

    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Test Guild')]);

    await seedGuildConfigsFromEnv(client as never);

    expect(getGuildConfig).toHaveBeenCalledWith('guild-1');
    expect(upsertGuildConfig).toHaveBeenCalledTimes(1);

    const [guildId, patch] = upsertGuildConfig.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(guildId).toBe('guild-1');
    expect(patch.verificationEnabled).toBe(true);
    expect(patch.verifiedRoleName).toBe('Member');
    expect(patch.tempMemberRoleName).toBe('Guest');
    expect(patch.potentialApplicantRoleName).toBe('Applicant');
    expect(patch.nominationDigestEnabled).toBe(true);
    expect(patch.nominationDigestChannelId).toBe('chan-123');
  });

  it('skips a guild that already has a config row', async () => {
    const existingConfig = { guildId: 'guild-1' };
    const getGuildConfig = jest.fn<() => Promise<object>>().mockResolvedValue(existingConfig);
    const upsertGuildConfig = jest.fn();

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Test Guild')]);

    await seedGuildConfigsFromEnv(client as never);

    expect(upsertGuildConfig).not.toHaveBeenCalled();
  });

  it('continues seeding remaining guilds when one throws', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const upsertGuildConfig = jest
      .fn<() => Promise<object>>()
      .mockRejectedValueOnce(new Error('DB error'))
      .mockResolvedValueOnce({});

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Guild A'), makeGuild('guild-2', 'Guild B')]);

    await expect(seedGuildConfigsFromEnv(client as never)).resolves.toBeUndefined();
    expect(upsertGuildConfig).toHaveBeenCalledTimes(2);
  });

  it('omits unset env vars from the patch — does not pass null for missing nullable fields', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const upsertGuildConfig = jest.fn<() => Promise<object>>().mockResolvedValue({});

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    // No env vars set — patch should be empty (or only contain explicitly set vars)
    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Test Guild')]);

    await seedGuildConfigsFromEnv(client as never);

    const [, patch] = upsertGuildConfig.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty('nominationDigestChannelId');
    expect(patch).not.toHaveProperty('manufacturingForumChannelId');
    expect(patch).not.toHaveProperty('birthdayChannelId');
    expect(patch).not.toHaveProperty('verificationEnabled');
  });

  it('parses DEFAULT_ROLES correctly and maps to the three role name fields', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const upsertGuildConfig = jest.fn<() => Promise<object>>().mockResolvedValue({});

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    process.env.DEFAULT_ROLES = 'Full Member , New Member , Prospect';

    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Test Guild')]);

    await seedGuildConfigsFromEnv(client as never);

    const [, patch] = upsertGuildConfig.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch.verifiedRoleName).toBe('Full Member');
    expect(patch.tempMemberRoleName).toBe('New Member');
    expect(patch.potentialApplicantRoleName).toBe('Prospect');
  });

  it('omits DEFAULT_ROLES fields from the patch when the env var is not set', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);
    const upsertGuildConfig = jest.fn<() => Promise<object>>().mockResolvedValue({});

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      upsertGuildConfig,
    }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), debug: jest.fn(), warn: jest.fn() }),
    }));

    // DEFAULT_ROLES not set — role name fields must not appear in the patch
    const { seedGuildConfigsFromEnv } = await import('../guild-config.seeder.js');
    const client = makeClient([makeGuild('guild-1', 'Test Guild')]);

    await seedGuildConfigsFromEnv(client as never);

    const [, patch] = upsertGuildConfig.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(patch).not.toHaveProperty('verifiedRoleName');
    expect(patch).not.toHaveProperty('tempMemberRoleName');
    expect(patch).not.toHaveProperty('potentialApplicantRoleName');
  });
});
