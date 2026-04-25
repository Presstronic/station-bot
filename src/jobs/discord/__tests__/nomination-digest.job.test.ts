import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { GuildConfig } from '../../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
});

type CronCallback = () => Promise<void>;

function makeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
    verificationEnabled: true,
    verifiedRoleName: 'Verified',
    tempMemberRoleName: 'Temporary Member',
    potentialApplicantRoleName: 'Potential Applicant',
    orgMemberRoleId: null,
    orgMemberRoleName: null,
    nominationDigestEnabled: true,
    nominationDigestChannelId: 'channel-123',
    nominationDigestRoleId: 'role-456',
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

async function setupMocks() {
  const mockWarn = jest.fn();
  const mockError = jest.fn();
  const countUnprocessedNominations = jest.fn(async () => 0);

  const capturedCallbacks = new Map<string, CronCallback>();
  let scheduleCallCount = 0;

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn: mockWarn, error: mockError, info: jest.fn(), debug: jest.fn() }),
  }));

  jest.unstable_mockModule('../../../services/nominations/nominations.repository.js', () => ({
    countUnprocessedNominations,
  }));

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn((_schedule: string) => true),
      schedule: jest.fn((_schedule: string, cb: CronCallback) => {
        const key = `task-${scheduleCallCount++}`;
        capturedCallbacks.set(key, cb);
        const stop = jest.fn();
        return { stop, _key: key };
      }),
    },
  }));

  return {
    countUnprocessedNominations,
    capturedCallbacks,
    mocks: { warn: mockWarn, error: mockError },
    runTaskByIndex: async (index: number) => {
      const key = `task-${index}`;
      const cb = capturedCallbacks.get(key);
      if (!cb) throw new Error(`No callback for task-${index}`);
      await cb();
    },
  };
}

function makeTextChannel() {
  return {
    isTextBased: () => true,
    send: jest.fn(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// scheduleNominationDigests
// ---------------------------------------------------------------------------

describe('scheduleNominationDigests', () => {
  it('creates one task per guild with digest enabled', async () => {
    const { } = await setupMocks();
    const getGuildConfigOrNull = jest.fn(async (guildId: string) =>
      makeGuildConfig({ guildId }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const cronMod = await import('node-cron');

    const configs = [
      makeGuildConfig({ guildId: 'guild-1' }),
      makeGuildConfig({ guildId: 'guild-2' }),
    ];
    const tasks = scheduleNominationDigests({} as never, configs);

    expect(tasks.size).toBe(2);
    expect(tasks.has('guild-1')).toBe(true);
    expect(tasks.has('guild-2')).toBe(true);
    expect((cronMod.default.schedule as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('does not create a task for a guild with nominationDigestEnabled=false', async () => {
    await setupMocks();
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(),
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const cronMod = await import('node-cron');

    const tasks = scheduleNominationDigests({} as never, [
      makeGuildConfig({ guildId: 'guild-1', nominationDigestEnabled: false }),
    ]);

    expect(tasks.size).toBe(0);
    expect((cronMod.default.schedule as jest.Mock)).not.toHaveBeenCalled();
  });

  it('does not create a task for a guild with nominationDigestChannelId=null', async () => {
    await setupMocks();
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(),
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const cronMod = await import('node-cron');

    const tasks = scheduleNominationDigests({} as never, [
      makeGuildConfig({ guildId: 'guild-1', nominationDigestChannelId: null }),
    ]);

    expect(tasks.size).toBe(0);
    expect((cronMod.default.schedule as jest.Mock)).not.toHaveBeenCalled();
  });

  it('logs error and skips a guild with an invalid cron schedule', async () => {
    const { mocks } = await setupMocks();
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(),
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);

    const tasks = scheduleNominationDigests({} as never, [
      makeGuildConfig({ guildId: 'guild-1', nominationDigestCronSchedule: 'not-valid' }),
    ]);

    expect(tasks.size).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
  });

  it('warns and skips when nominationDigestEnabled is false at tick time', async () => {
    const { runTaskByIndex, mocks } = await setupMocks();
    const getGuildConfigOrNull = jest.fn(async () =>
      makeGuildConfig({ nominationDigestEnabled: false }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const client = { channels: { fetch: jest.fn() } };

    scheduleNominationDigests(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('Digest disabled for guild'),
      expect.any(Object),
    );
    expect(client.channels.fetch).not.toHaveBeenCalled();
  });

  it('stops an existing task before creating a new one for the same guild', async () => {
    await setupMocks();
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(),
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');

    const firstCall = scheduleNominationDigests({} as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    const firstTask = firstCall.get('guild-1') as unknown as { stop: jest.Mock };

    scheduleNominationDigests({} as never, [makeGuildConfig({ guildId: 'guild-1' })]);

    expect(firstTask.stop).toHaveBeenCalledTimes(1);
  });

  it('sends the zero-count digest message on tick', async () => {
    const { runTaskByIndex, countUnprocessedNominations } = await setupMocks();
    const channel = makeTextChannel();
    const getGuildConfigOrNull = jest.fn(async () =>
      makeGuildConfig({ nominationDigestChannelId: 'channel-123', nominationDigestRoleId: 'role-456' }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const client = { channels: { fetch: jest.fn(async () => channel) } };

    countUnprocessedNominations.mockResolvedValueOnce(0);
    scheduleNominationDigests(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await runTaskByIndex(0);

    expect(channel.send).toHaveBeenCalledWith({
      content: '<@&role-456> Daily nomination digest: there are currently no unprocessed nominations in the queue.',
      allowedMentions: { roles: ['role-456'] },
    });
  });

  it('sends the non-zero digest message on tick', async () => {
    const { runTaskByIndex, countUnprocessedNominations } = await setupMocks();
    const channel = makeTextChannel();
    const getGuildConfigOrNull = jest.fn(async () =>
      makeGuildConfig({ nominationDigestChannelId: 'channel-123', nominationDigestRoleId: 'role-456' }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const client = { channels: { fetch: jest.fn(async () => channel) } };

    countUnprocessedNominations.mockResolvedValueOnce(12);
    scheduleNominationDigests(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await runTaskByIndex(0);

    expect(channel.send).toHaveBeenCalledWith({
      content: '<@&role-456> Daily nomination digest: **12** unprocessed nomination(s) are currently in the queue.',
      allowedMentions: { roles: ['role-456'] },
    });
  });

  it('warns and does not throw when channel fetch fails', async () => {
    const { runTaskByIndex, mocks } = await setupMocks();
    const getGuildConfigOrNull = jest.fn(async () =>
      makeGuildConfig({ nominationDigestChannelId: 'channel-123', nominationDigestRoleId: 'role-456' }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const client = { channels: { fetch: jest.fn(async () => { throw new Error('missing access'); }) } };

    scheduleNominationDigests(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch digest channel'),
      expect.any(Object),
    );
  });

  it('warns and does not throw when the channel is not text-based', async () => {
    const { runTaskByIndex, mocks } = await setupMocks();
    const getGuildConfigOrNull = jest.fn(async () =>
      makeGuildConfig({ nominationDigestChannelId: 'channel-123', nominationDigestRoleId: 'role-456' }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');
    const client = { channels: { fetch: jest.fn(async () => ({ isTextBased: () => false })) } };

    scheduleNominationDigests(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not text-based'),
      expect.any(Object),
    );
  });

  it("one guild's tick failure does not abort the other guild", async () => {
    const { runTaskByIndex, countUnprocessedNominations } = await setupMocks();
    const channel1 = makeTextChannel();
    const channel2 = makeTextChannel();

    const getGuildConfigOrNull = jest.fn(async (guildId: string) =>
      makeGuildConfig({ guildId, nominationDigestChannelId: `ch-${guildId}`, nominationDigestRoleId: 'role-456' }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests } = await import('../nomination-digest.job.js');

    const client = {
      channels: {
        fetch: jest.fn(async (chId: string) => {
          if (chId === 'ch-guild-1') return channel1;
          return channel2;
        }),
      },
    };

    countUnprocessedNominations.mockResolvedValue(3);
    channel1.send = jest.fn(async () => { throw new Error('guild-1 send failed'); });

    scheduleNominationDigests(client as never, [
      makeGuildConfig({ guildId: 'guild-1' }),
      makeGuildConfig({ guildId: 'guild-2' }),
    ]);

    await runTaskByIndex(0);
    await runTaskByIndex(1);

    expect(channel2.send).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// rescheduleGuildDigest
// ---------------------------------------------------------------------------

describe('rescheduleGuildDigest', () => {
  it('cancels the existing task and returns a new one', async () => {
    await setupMocks();
    const getGuildConfigOrNull = jest.fn(async (guildId: string) =>
      makeGuildConfig({ guildId }),
    );
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull,
      getAllGuildConfigs: jest.fn(),
    }));

    const { scheduleNominationDigests, rescheduleGuildDigest } = await import('../nomination-digest.job.js');

    const existingTask = scheduleNominationDigests({} as never, [
      makeGuildConfig({ guildId: 'guild-1' }),
    ]).get('guild-1') as unknown as { stop: jest.Mock };

    const newTask = rescheduleGuildDigest({} as never, 'guild-1', '0 12 * * *');

    expect(existingTask.stop).toHaveBeenCalledTimes(1);
    expect(newTask).not.toBeNull();
    expect(newTask).not.toBe(existingTask);
  });

  it('returns null and logs error when the new cron schedule is invalid', async () => {
    const { mocks } = await setupMocks();
    jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
      getGuildConfigOrNull: jest.fn(),
      getAllGuildConfigs: jest.fn(),
    }));

    const { rescheduleGuildDigest } = await import('../nomination-digest.job.js');
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);

    const result = rescheduleGuildDigest({} as never, 'guild-1', 'bad-cron');

    expect(result).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
  });
});
