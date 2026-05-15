import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import i18n from '../../../utils/i18n-config.js';
import { purgeMembers } from '../purge-member.job.js';
import { Client, Guild, GuildMember, Role, Collection } from 'discord.js';
import type { GuildConfig } from '../../../domain/guild-config/guild-config.service.js';

// Lightweight mock type for Guild, safe for test usage
type MockGuild = {
  name: string;
  preferredLocale: string;
  members: {
    fetch: () => Promise<Collection<string, GuildMember>>;
    cache: Map<string, GuildMember>;
  };
};

function toCollection(members: GuildMember[]): Collection<string, GuildMember> {
  return new Collection(members.map((m) => [m.user.tag, m]));
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
    manufacturingCreateOrderPostTitle: '📋 Create Order',
    manufacturingCreateOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: true,
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

function makeMockClient(guildId = 'guild-1', guildName = 'Test Guild') {
  return {
    guilds: {
      cache: new Map([[guildId, { id: guildId, name: guildName, preferredLocale: 'en-US' }]]),
    },
  } as unknown as Client;
}

type CronCallback = () => Promise<void>;

beforeEach(() => {
  jest.resetModules();
});

describe('schedulePurgeJobs', () => {
  async function setupMocks(opts: {
    validateResult?: boolean;
    guildConfigResult?: GuildConfig | null;
  } = {}) {
    const { validateResult = true, guildConfigResult = makeGuildConfig() } = opts;
    const capturedCallbacks = new Map<string, CronCallback>();
    let scheduleCallCount = 0;

    const mockWarn = jest.fn();
    const mockInfo = jest.fn();
    const mockError = jest.fn();

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), info: mockInfo, warn: mockWarn, error: mockError }),
    }));
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(async () => guildConfigResult),
    }));
    jest.unstable_mockModule('node-cron', () => ({
      default: {
        validate: jest.fn(() => validateResult),
        schedule: jest.fn((_schedule: string, cb: CronCallback) => {
          const key = `task-${scheduleCallCount++}`;
          capturedCallbacks.set(key, cb);
          return { stop: jest.fn(), _key: key };
        }),
      },
    }));

    const { schedulePurgeJobs, rescheduleGuildPurge } = await import('../purge-member.job.js');
    return { schedulePurgeJobs, rescheduleGuildPurge, capturedCallbacks, mockWarn, mockInfo, mockError };
  }

  it('creates one task per guild with purgeJobsEnabled=true', async () => {
    const { schedulePurgeJobs } = await setupMocks();
    const configs = [
      makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true }),
      makeGuildConfig({ guildId: 'g2', purgeJobsEnabled: false }),
      makeGuildConfig({ guildId: 'g3', purgeJobsEnabled: true }),
    ];

    const tasks = schedulePurgeJobs(makeMockClient('g1'), configs);
    expect(tasks.size).toBe(2);
    expect(tasks.has('g1')).toBe(true);
    expect(tasks.has('g2')).toBe(false);
    expect(tasks.has('g3')).toBe(true);
  });

  it('skips guilds with purgeJobsEnabled=false and creates no task', async () => {
    const { schedulePurgeJobs } = await setupMocks();
    const configs = [makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: false })];
    const tasks = schedulePurgeJobs(makeMockClient('g1'), configs);
    expect(tasks.size).toBe(0);
  });

  it('skips guilds with invalid cron schedule and logs error', async () => {
    const { schedulePurgeJobs, mockError } = await setupMocks({ validateResult: false });
    const configs = [makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true })];
    const tasks = schedulePurgeJobs(makeMockClient('g1'), configs);
    expect(tasks.size).toBe(0);
    expect(mockError).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
  });

  it('stops all existing tasks and reschedules on repeated calls', async () => {
    const { schedulePurgeJobs } = await setupMocks();
    const configs = [makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true })];
    const client = makeMockClient('g1');
    const first = schedulePurgeJobs(client, configs);
    const firstTask = first.get('g1') as unknown as { stop: jest.Mock };
    schedulePurgeJobs(client, configs);
    expect(firstTask.stop).toHaveBeenCalledTimes(1);
  });

  it('tick skips when guild config is unavailable', async () => {
    const { schedulePurgeJobs, capturedCallbacks, mockWarn } = await setupMocks({
      guildConfigResult: null,
    });
    const configs = [makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true })];
    schedulePurgeJobs(makeMockClient('g1'), configs);
    const [cb] = capturedCallbacks.values();
    await cb();
    expect(mockWarn).toHaveBeenCalledWith(
      expect.stringContaining('Guild config unavailable'),
      expect.any(Object),
    );
  });

  it('tick uses tempMemberHoursToExpire from guild config rather than a hardcoded value', async () => {
    const customHours = 24;
    const { schedulePurgeJobs, capturedCallbacks } = await setupMocks({
      guildConfigResult: makeGuildConfig({ guildId: 'g1', tempMemberHoursToExpire: customHours }),
    });

    const mockGuild = {
      id: 'g1',
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn(async () => new Map()),
        cache: new Map<string, unknown>([
          [
            'member-1',
            {
              user: { tag: 'OldMember#1111', send: jest.fn() },
              roles: { cache: [{ name: 'Temporary Member' }] },
              joinedTimestamp: Date.now() - (customHours + 1) * 60 * 60 * 1000,
              kickable: true,
              kick: jest.fn(),
            },
          ],
        ]),
      },
    };

    const client = {
      guilds: { cache: new Map([['g1', mockGuild]]) },
    } as unknown as Client;

    schedulePurgeJobs(client, [makeGuildConfig({ guildId: 'g1', tempMemberHoursToExpire: customHours })]);
    const [cb] = capturedCallbacks.values();
    await cb();

    const member = mockGuild.members.cache.get('member-1') as { kick: jest.Mock };
    expect(member.kick).toHaveBeenCalledTimes(1);
  });
});

describe('rescheduleGuildPurge', () => {
  async function setupMocks() {
    const mockError = jest.fn();
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: mockError }),
    }));
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(async () => null),
    }));
    const scheduleMock = jest.fn((_schedule: string, _cb: CronCallback) => ({ stop: jest.fn() }));
    jest.unstable_mockModule('node-cron', () => ({
      default: {
        validate: jest.fn(() => true),
        schedule: scheduleMock,
      },
    }));
    const { schedulePurgeJobs, rescheduleGuildPurge } = await import('../purge-member.job.js');
    return { schedulePurgeJobs, rescheduleGuildPurge, scheduleMock, mockError };
  }

  it('stops old task and starts a new one', async () => {
    const { schedulePurgeJobs, rescheduleGuildPurge, scheduleMock } = await setupMocks();
    const client = makeMockClient('g1');
    const config = makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true });
    schedulePurgeJobs(client, [config]);
    const oldTask = scheduleMock.mock.results[0].value as { stop: jest.Mock };

    rescheduleGuildPurge(client, 'g1', makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true }));
    expect(oldTask.stop).toHaveBeenCalledTimes(1);
    expect(scheduleMock).toHaveBeenCalledTimes(2);
  });

  it('returns no-op task when purgeJobsEnabled is false', async () => {
    const { rescheduleGuildPurge } = await setupMocks();
    const task = rescheduleGuildPurge(
      makeMockClient('g1'),
      'g1',
      makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: false }),
    );
    expect(task).toBeDefined();
    expect(() => task.stop()).not.toThrow();
  });

  it('returns no-op task and logs error on invalid cron schedule', async () => {
    const { mockError } = await setupMocks();

    jest.resetModules();
    const logErr = jest.fn();
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: logErr }),
    }));
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(async () => null),
    }));
    jest.unstable_mockModule('node-cron', () => ({
      default: {
        validate: jest.fn(() => false),
        schedule: jest.fn(),
      },
    }));
    const { rescheduleGuildPurge: rescheduleFresh } = await import('../purge-member.job.js');

    const task = rescheduleFresh(
      makeMockClient('g1'),
      'g1',
      makeGuildConfig({ guildId: 'g1', purgeJobsEnabled: true }),
    );
    expect(task).toBeDefined();
    expect(() => task.stop()).not.toThrow();
    expect(logErr).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
    void mockError;
  });
});

describe('purgeMembers - Temporary Member', () => {
  let mockGuild: MockGuild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    const tempRole = { id: 'tempRoleId', name: 'Temporary Member' } as Role;
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
    ] as unknown as GuildMember[];
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn<() => Promise<Collection<string, GuildMember>>>()
          .mockResolvedValue(toCollection(mockMembers)),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    };
  });

  it('kicks Temporary Members who joined more than 48 hours ago', async () => {
    const HOURS_TO_EXPIRE = 48;
    const locale = mockGuild.preferredLocale;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^ -~]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString(),
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild as unknown as Guild,
      'Temporary Member',
      HOURS_TO_EXPIRE,
      'TEST TEMPORARY MEMBERS TIME LIMIT',
      message
    );

    expect(kickedMembers).toEqual(['OldTempMember#1234']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});

describe('purgeMembers - Potential Applicant', () => {
  let mockGuild: MockGuild;
  let mockMembers: GuildMember[];

  beforeEach(() => {
    const applicantRole = { id: 'applicantRoleId', name: 'Potential Applicant' } as Role;
    const now = Date.now();

    mockMembers = [
      {
        user: { tag: 'OldApplicant#1111', send: jest.fn() },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 31 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'NewApplicant#2222', send: jest.fn() },
        roles: { cache: [applicantRole] },
        joinedTimestamp: now - 10 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
      {
        user: { tag: 'DifferentRoleUser#3333', send: jest.fn() },
        roles: { cache: [] },
        joinedTimestamp: now - 50 * 24 * 60 * 60 * 1000,
        kick: jest.fn(),
        kickable: true,
      },
    ] as unknown as GuildMember[];
    mockGuild = {
      name: 'Test Guild',
      preferredLocale: 'en-US',
      members: {
        fetch: jest.fn<() => Promise<Collection<string, GuildMember>>>()
          .mockResolvedValue(toCollection(mockMembers)),
        cache: new Map(mockMembers.map((m) => [m.user.tag, m])),
      },
    };
  });

  it('kicks Potential Applicant members who joined more than 30 days (720 hours) ago', async () => {
    const HOURS_TO_EXPIRE = 720;
    const locale = mockGuild.preferredLocale;
    const message = i18n.__mf(
      { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale },
      {
        cleanGuildName: mockGuild.name.replace(/[^ -~]/g, ''),
        hoursToExpire: HOURS_TO_EXPIRE.toString(),
      }
    );

    const kickedMembers = await purgeMembers(
      mockGuild as unknown as Guild,
      'Potential Applicant',
      HOURS_TO_EXPIRE,
      'TEST POTENTIAL APPLICANT TIME LIMIT',
      message
    );

    expect(kickedMembers).toEqual(['OldApplicant#1111']);
    expect(mockMembers[0].kick).toHaveBeenCalledTimes(1);
    expect(mockMembers[1].kick).not.toHaveBeenCalled();
    expect(mockMembers[2].kick).not.toHaveBeenCalled();
  });
});
