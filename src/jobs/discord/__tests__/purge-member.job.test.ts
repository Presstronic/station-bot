import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { Collection, type Client, type Guild, type GuildMember, type Role } from 'discord.js';
import type { GuildConfig } from '../../../domain/guild-config/guild-config.service.js';

type MockMember = GuildMember & {
  user: { tag: string; send: ReturnType<typeof jest.fn> };
  kick: ReturnType<typeof jest.fn>;
  kickable: boolean;
};

type MockGuild = {
  id: string;
  name: string;
  preferredLocale: string;
  members: {
    fetch: () => Promise<Collection<string, GuildMember>>;
    cache: Map<string, GuildMember>;
  };
};

type MockScheduledTask = {
  stop: ReturnType<typeof jest.fn>;
  destroy: ReturnType<typeof jest.fn>;
};

function toCollection(members: GuildMember[]): Collection<string, GuildMember> {
  return new Collection(members.map((member) => [member.user.tag, member]));
}

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
    manufacturingCreateOrderPostTitle: 'Create Order',
    manufacturingCreateOrderPostMessage: 'Create an order',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: true,
    tempMemberHoursToExpire: 48,
    tempMemberPurgeCronSchedule: '0 3 * * *',
    birthdayEnabled: false,
    birthdayChannelId: null,
    birthdayCronSchedule: '0 12 * * *',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('purgeMembers', () => {
  let mockGuild: MockGuild;
  let mockMembers: MockMember[];

  beforeEach(() => {
    const tempRole = { id: 'temp-role', name: 'Temporary Member' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { tag: 'OldTempMember#1234', send: jest.fn() },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 49 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NewTempMember#5678', send: jest.fn() },
        roles: { cache: [tempRole] },
        joinedTimestamp: now - 10 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NoTempRoleUser#9999', send: jest.fn() },
        roles: { cache: [] },
        joinedTimestamp: now - 100 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
    ] as unknown as MockMember[];

    mockGuild = {
      id: 'guild-1',
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn<() => Promise<Collection<string, GuildMember>>>().mockResolvedValue(toCollection(mockMembers)),
        cache: new Map(mockMembers.map((member) => [member.user.tag, member])),
      },
    };
  });

  it('kicks members whose temp-role membership is past the configured expiry', async () => {
    const { purgeMembers } = await import('../purge-member.job.js');

    const kickedMembers = await purgeMembers(
      mockGuild as unknown as Guild,
      'Temporary Member',
      48,
      'TEST TEMPORARY MEMBERS TIME LIMIT',
      'purge message',
    );

    expect(kickedMembers).toEqual(['OldTempMember#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});

describe('schedulePurgeJobs', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  async function setup() {
    const scheduleMock = jest.fn((_: string, callback: () => Promise<void>) => ({
      stop: jest.fn(),
      destroy: jest.fn(),
      __callback: callback,
    }));
    const validateMock = jest.fn((schedule: string) => schedule !== 'bad-cron');
    const getGuildConfigOrNull = jest.fn(async () => null);

    await jest.unstable_mockModule('node-cron', () => ({
      default: {
        schedule: scheduleMock,
        validate: validateMock,
      },
    }));
    await jest.unstable_mockModule('i18n', () => ({
      default: { __mf: jest.fn(() => 'translated message') },
    }));
    await jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
    }));

    const mod = await import('../purge-member.job.js');
    return { ...mod, scheduleMock, validateMock, getGuildConfigOrNull };
  }

  it('returns one task per guild where purgeJobsEnabled is true', async () => {
    const { schedulePurgeJobs, scheduleMock } = await setup();

    const tasks = schedulePurgeJobs({} as Client, [
      makeGuildConfig({ guildId: 'guild-1', purgeJobsEnabled: true }),
      makeGuildConfig({ guildId: 'guild-2', purgeJobsEnabled: false }),
      makeGuildConfig({ guildId: 'guild-3', purgeJobsEnabled: true, tempMemberPurgeCronSchedule: '0 5 * * *' }),
    ]);

    expect(tasks.size).toBe(2);
    expect([...tasks.keys()]).toEqual(['guild-1', 'guild-3']);
    expect(scheduleMock).toHaveBeenCalledTimes(2);
  });

  it('skips guilds with purgeJobsEnabled=false', async () => {
    const { schedulePurgeJobs, scheduleMock } = await setup();

    const tasks = schedulePurgeJobs({} as Client, [
      makeGuildConfig({ guildId: 'guild-1', purgeJobsEnabled: false }),
    ]);

    expect(tasks.size).toBe(0);
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it('rescheduleGuildPurge stops the old task and starts a new one', async () => {
    const { schedulePurgeJobs, rescheduleGuildPurge } = await setup();
    const initialConfig = makeGuildConfig({ guildId: 'guild-1' });
    const originalTask = schedulePurgeJobs({} as Client, [initialConfig]).get('guild-1');

    const newTask = rescheduleGuildPurge(
      {} as Client,
      'guild-1',
      makeGuildConfig({ guildId: 'guild-1', tempMemberPurgeCronSchedule: '0 12 * * *' }),
    );

    expect(originalTask).toBeDefined();
    const managedOriginalTask = originalTask as unknown as MockScheduledTask;
    expect(managedOriginalTask.stop).toHaveBeenCalledTimes(1);
    expect(managedOriginalTask.destroy).toHaveBeenCalledTimes(1);
    expect(newTask).not.toBe(originalTask);
  });

  it('destroys the old task when a guild is disabled', async () => {
    const { schedulePurgeJobs } = await setup();
    const originalTask = schedulePurgeJobs({} as Client, [makeGuildConfig({ guildId: 'guild-1' })]).get('guild-1');

    const tasks = schedulePurgeJobs({} as Client, [
      makeGuildConfig({ guildId: 'guild-1', purgeJobsEnabled: false }),
    ]);

    expect(tasks.size).toBe(0);
    expect(originalTask).toBeDefined();
    const managedOriginalTask = originalTask as unknown as MockScheduledTask;
    expect(managedOriginalTask.stop).toHaveBeenCalledTimes(1);
    expect(managedOriginalTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('destroys tasks for guilds that are no longer in the incoming config set', async () => {
    const { schedulePurgeJobs } = await setup();
    const originalTask = schedulePurgeJobs({} as Client, [makeGuildConfig({ guildId: 'guild-1' })]).get('guild-1');

    const tasks = schedulePurgeJobs({} as Client, [makeGuildConfig({ guildId: 'guild-2' })]);

    expect(tasks.has('guild-1')).toBe(false);
    expect(originalTask).toBeDefined();
    const managedOriginalTask = originalTask as unknown as MockScheduledTask;
    expect(managedOriginalTask.stop).toHaveBeenCalledTimes(1);
    expect(managedOriginalTask.destroy).toHaveBeenCalledTimes(1);
  });

  it('uses guildConfig.tempMemberHoursToExpire during the scheduled purge tick', async () => {
    const now = Date.now();
    const tempRole = { id: 'temp-role', name: 'Config Temp Role' } as Role;
    const kick = jest.fn();
    const mockGuild = {
      id: 'guild-1',
      name: 'Schedule Test',
      preferredLocale: 'de-DE',
      members: {
        fetch: jest.fn(async () => new Collection()),
        cache: new Map([
          ['member-1', {
            user: { tag: 'ExpiredUser#0001', send: jest.fn() },
            roles: { cache: [tempRole] },
            joinedTimestamp: now - 13 * 60 * 60 * 1000,
            kick,
            kickable: true,
          }],
        ]),
      },
    };

    const scheduleMock = jest.fn((_: string, callback: () => Promise<void>) => ({
      stop: jest.fn(),
      destroy: jest.fn(),
      __callback: callback,
    }));
    const validateMock = jest.fn(() => true);
    const getGuildConfigOrNull = jest.fn(async () => makeGuildConfig({
      guildId: 'guild-1',
      tempMemberRoleName: 'Config Temp Role',
      tempMemberHoursToExpire: 12,
      tempMemberPurgeCronSchedule: '0 3 * * *',
    }));
    const i18nMf = jest.fn(() => 'translated message');

    await jest.unstable_mockModule('node-cron', () => ({
      default: {
        schedule: scheduleMock,
        validate: validateMock,
      },
    }));
    await jest.unstable_mockModule('i18n', () => ({
      default: { __mf: i18nMf },
    }));
    await jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
    }));

    const { schedulePurgeJobs } = await import('../purge-member.job.js');
    const tasks = schedulePurgeJobs({
      guilds: { cache: new Map([['guild-1', mockGuild]]) },
    } as unknown as Client, [makeGuildConfig({ guildId: 'guild-1' })]);

    const scheduledTask = tasks.get('guild-1') as unknown as { __callback: () => Promise<void> };
    await scheduledTask.__callback();

    expect(kick).toHaveBeenCalledWith('TEMPORARY MEMBERS TIME LIMIT');
    expect(i18nMf).toHaveBeenCalledWith(
      expect.objectContaining({ locale: 'de' }),
      expect.objectContaining({ hoursToExpire: '12' }),
    );
  });

  it('returns a no-op task when rescheduleGuildPurge receives an invalid cron schedule', async () => {
    const { rescheduleGuildPurge, scheduleMock } = await setup();

    const task = rescheduleGuildPurge(
      {} as Client,
      'guild-1',
      makeGuildConfig({ guildId: 'guild-1', tempMemberPurgeCronSchedule: 'bad-cron' }),
    );

    expect(scheduleMock).not.toHaveBeenCalled();
    expect(task.stop).toEqual(expect.any(Function));
  });
});
