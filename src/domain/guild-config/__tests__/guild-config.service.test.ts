import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { GuildConfig } from '../guild-config.repository.js';

beforeEach(() => {
  jest.resetModules();
});

function makeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
    verificationEnabled: true,
    verifiedRoleName: 'Verified',
    tempMemberRoleName: 'Temporary Member',
    potentialApplicantRoleName: 'Potential Applicant',
    orgMemberRoleId: null,
    orgMemberRoleName: null,
    nominationDigestEnabled: false,
    nominationDigestChannelId: null,
    nominationDigestRoleId: null,
    nominationDigestCronSchedule: '0 9 * * *',
    manufacturingEnabled: false,
    manufacturingForumChannelId: null,
    manufacturingStaffChannelId: null,
    manufacturingRoleId: null,
    manufacturingCreateOrderThreadId: null,
    manufacturingOrderLimit: 5,
    manufacturingMaxItemsPerOrder: 10,
    manufacturingOrderRateLimitPer5Min: 1,
    manufacturingOrderRateLimitPerHour: 5,
    manufacturingCreateOrderPostTitle: '📋 Create Order',
    manufacturingCreateOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: false,
    tempMemberHoursToExpire: 48,
    tempMemberPurgeCronSchedule: '0 3 * * *',
    birthdayEnabled: false,
    birthdayChannelId: null,
    birthdayCronSchedule: '0 12 * * *',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getGuildConfigOrNull
// ---------------------------------------------------------------------------

describe('getGuildConfigOrNull', () => {
  it('returns the config when the repository returns a row', async () => {
    const config = makeGuildConfig();
    const getGuildConfig = jest.fn<() => Promise<GuildConfig>>().mockResolvedValue(config);

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => config),
    }));

    const { getGuildConfigOrNull } = await import('../guild-config.service.js');
    const result = await getGuildConfigOrNull('guild-1');

    expect(result).toBe(config);
    expect(getGuildConfig).toHaveBeenCalledWith('guild-1');
  });

  it('returns null when the repository returns null', async () => {
    const getGuildConfig = jest.fn<() => Promise<null>>().mockResolvedValue(null);

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { getGuildConfigOrNull } = await import('../guild-config.service.js');
    expect(await getGuildConfigOrNull('unknown')).toBeNull();
  });

  it('propagates errors thrown by the repository', async () => {
    const dbError = new Error('DB connection failed');
    const getGuildConfig = jest.fn<() => Promise<GuildConfig>>().mockRejectedValue(dbError);

    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig,
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { getGuildConfigOrNull } = await import('../guild-config.service.js');
    await expect(getGuildConfigOrNull('guild-1')).rejects.toThrow('DB connection failed');
  });
});

// ---------------------------------------------------------------------------
// isFeatureEnabledForGuild
// ---------------------------------------------------------------------------

describe('isFeatureEnabledForGuild', () => {
  it('returns false when botLevelEnabled is false, regardless of guild config', async () => {
    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig: jest.fn(),
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { isFeatureEnabledForGuild } = await import('../guild-config.service.js');
    const config = makeGuildConfig({ verificationEnabled: true, manufacturingEnabled: true });

    expect(isFeatureEnabledForGuild(false, config, 'verification')).toBe(false);
    expect(isFeatureEnabledForGuild(false, config, 'manufacturing')).toBe(false);
  });

  it('returns false when guildConfig is null', async () => {
    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig: jest.fn(),
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { isFeatureEnabledForGuild } = await import('../guild-config.service.js');

    expect(isFeatureEnabledForGuild(true, null, 'verification')).toBe(false);
    expect(isFeatureEnabledForGuild(true, null, 'manufacturing')).toBe(false);
  });

  it('returns true for each feature when both botLevelEnabled and the guild flag are true', async () => {
    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig: jest.fn(),
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { isFeatureEnabledForGuild } = await import('../guild-config.service.js');
    const config = makeGuildConfig({
      verificationEnabled: true,
      nominationDigestEnabled: true,
      manufacturingEnabled: true,
      purgeJobsEnabled: true,
      birthdayEnabled: true,
    });

    expect(isFeatureEnabledForGuild(true, config, 'verification')).toBe(true);
    expect(isFeatureEnabledForGuild(true, config, 'nominationDigest')).toBe(true);
    expect(isFeatureEnabledForGuild(true, config, 'manufacturing')).toBe(true);
    expect(isFeatureEnabledForGuild(true, config, 'purgeJobs')).toBe(true);
    expect(isFeatureEnabledForGuild(true, config, 'birthday')).toBe(true);
  });

  it('returns false when the guild config flag is false even if botLevelEnabled is true', async () => {
    jest.unstable_mockModule('../guild-config.repository.js', () => ({
      getGuildConfig: jest.fn(),
      getAllGuildConfigs: jest.fn(async () => []),
      upsertGuildConfig: jest.fn(async () => makeGuildConfig()),
    }));

    const { isFeatureEnabledForGuild } = await import('../guild-config.service.js');
    const config = makeGuildConfig({
      verificationEnabled: false,
      nominationDigestEnabled: false,
      manufacturingEnabled: false,
      purgeJobsEnabled: false,
      birthdayEnabled: false,
    });

    expect(isFeatureEnabledForGuild(true, config, 'verification')).toBe(false);
    expect(isFeatureEnabledForGuild(true, config, 'nominationDigest')).toBe(false);
    expect(isFeatureEnabledForGuild(true, config, 'manufacturing')).toBe(false);
    expect(isFeatureEnabledForGuild(true, config, 'purgeJobs')).toBe(false);
    expect(isFeatureEnabledForGuild(true, config, 'birthday')).toBe(false);
  });
});
