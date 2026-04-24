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
    nominationDigestEnabled: false,
    nominationDigestChannelId: null,
    nominationDigestRoleId: null,
    nominationDigestCronSchedule: '0 9 * * *',
    manufacturingEnabled: true,
    manufacturingForumChannelId: 'forum-ch',
    manufacturingStaffChannelId: 'staff-ch',
    manufacturingRoleId: 'mfg-role',
    manufacturingCreateOrderThreadId: 'thread-123',
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

async function setupMocks(getGuildConfigResult: GuildConfig | null = makeGuildConfig()) {
  const capturedCallbacks = new Map<string, CronCallback>();
  let scheduleCallCount = 0;

  const mockWarn = jest.fn();
  const mockInfo = jest.fn();
  const mockDebug = jest.fn();
  const mockError = jest.fn();

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn: mockWarn, info: mockInfo, debug: mockDebug, error: mockError }),
  }));

  jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull: jest.fn(async () => getGuildConfigResult),
    getAllGuildConfigs: jest.fn(async () => []),
    isFeatureEnabledForGuild: jest.fn(() => false),
    upsertGuildConfig: jest.fn(async () => getGuildConfigResult ?? makeGuildConfig()),
  }));

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn((_schedule: string) => true),
      schedule: jest.fn((_schedule: string, cb: CronCallback) => {
        const key = `task-${scheduleCallCount++}`;
        capturedCallbacks.set(key, cb);
        return { stop: jest.fn(), _key: key };
      }),
    },
  }));

  const { scheduleManufacturingKeepalives, rescheduleGuildKeepalive } = await import('../manufacturing-keepalive.job.js');

  return {
    scheduleManufacturingKeepalives,
    rescheduleGuildKeepalive,
    capturedCallbacks,
    mocks: { warn: mockWarn, info: mockInfo, debug: mockDebug, error: mockError },
    runTaskByIndex: async (index: number) => {
      const key = `task-${index}`;
      const cb = capturedCallbacks.get(key);
      if (!cb) throw new Error(`No callback for task-${index}`);
      await cb();
    },
  };
}

function makeThread(archived: boolean | null = false) {
  return {
    id: 'thread-123',
    isThread: () => true,
    archived,
    setArchived: jest.fn(async () => {}),
  };
}

function makeClient(fetchResult: unknown = null) {
  return {
    channels: {
      fetch: jest.fn(async () => fetchResult),
    },
  };
}

// ---------------------------------------------------------------------------
// scheduleManufacturingKeepalives
// ---------------------------------------------------------------------------

describe('scheduleManufacturingKeepalives', () => {
  it('creates one task per guild with manufacturing enabled', async () => {
    const { scheduleManufacturingKeepalives } = await setupMocks();
    const cronMod = await import('node-cron');

    const configs = [
      makeGuildConfig({ guildId: 'guild-1' }),
      makeGuildConfig({ guildId: 'guild-2' }),
    ];
    const tasks = scheduleManufacturingKeepalives({} as never, configs);

    expect(tasks.size).toBe(2);
    expect(tasks.has('guild-1')).toBe(true);
    expect(tasks.has('guild-2')).toBe(true);
    expect((cronMod.default.schedule as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('does not create a task for a guild with manufacturingEnabled=false', async () => {
    const { scheduleManufacturingKeepalives } = await setupMocks();
    const cronMod = await import('node-cron');

    const tasks = scheduleManufacturingKeepalives({} as never, [
      makeGuildConfig({ guildId: 'guild-1', manufacturingEnabled: false }),
    ]);

    expect(tasks.size).toBe(0);
    expect((cronMod.default.schedule as jest.Mock)).not.toHaveBeenCalled();
  });

  it('logs error and skips a guild with an invalid cron schedule', async () => {
    const { scheduleManufacturingKeepalives, mocks } = await setupMocks();
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);

    const tasks = scheduleManufacturingKeepalives({} as never, [
      makeGuildConfig({ guildId: 'guild-1', manufacturingKeepaliveCronSchedule: 'not-valid' }),
    ]);

    expect(tasks.size).toBe(0);
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('invalid cron schedule'),
      expect.any(Object),
    );
  });

  it('calls setArchived(false) when the thread is archived', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex } = await setupMocks();
    const thread = makeThread(true);
    const client = makeClient(thread);

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await runTaskByIndex(0);

    expect(thread.setArchived).toHaveBeenCalledWith(false);
  });

  it('does not call setArchived when the thread is active', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks();
    const thread = makeThread(false);
    const client = makeClient(thread);

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await runTaskByIndex(0);

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(mocks.debug).toHaveBeenCalledWith(expect.stringContaining('active'));
  });

  it('warns and skips fetch when createOrderThreadId is null in re-fetched config', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks(
      makeGuildConfig({ manufacturingCreateOrderThreadId: null }),
    );
    const client = makeClient();

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await runTaskByIndex(0);

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('no createOrderThreadId'), expect.any(Object));
  });

  it('warns when fetch returns null (thread not found or inaccessible)', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks();
    const client = makeClient(null);

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not found or is not accessible'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when fetched channel is not a thread', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks();
    const nonThread = { isThread: () => false, id: 'not-a-thread' };
    const client = makeClient(nonThread);

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a thread'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when channel fetch fails', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks();
    const client = {
      channels: {
        fetch: jest.fn(async () => { throw new Error('network error'); }),
      },
    };

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to fetch'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when setArchived throws', async () => {
    const { scheduleManufacturingKeepalives, runTaskByIndex, mocks } = await setupMocks();
    const thread = makeThread(true);
    (thread.setArchived as jest.Mock).mockImplementation(async () => { throw new Error('Missing Permissions'); });
    const client = makeClient(thread);

    scheduleManufacturingKeepalives(client as never, [makeGuildConfig({ guildId: 'guild-1' })]);
    await expect(runTaskByIndex(0)).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to unarchive'),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// rescheduleGuildKeepalive
// ---------------------------------------------------------------------------

describe('rescheduleGuildKeepalive', () => {
  it('cancels the existing task and returns a new one', async () => {
    const { scheduleManufacturingKeepalives, rescheduleGuildKeepalive } = await setupMocks();

    const existingTask = scheduleManufacturingKeepalives({} as never, [
      makeGuildConfig({ guildId: 'guild-1' }),
    ]).get('guild-1') as unknown as { stop: jest.Mock };

    const newTask = rescheduleGuildKeepalive({} as never, 'guild-1', makeGuildConfig({ guildId: 'guild-1' }));

    expect(existingTask.stop).toHaveBeenCalledTimes(1);
    expect(newTask).not.toBeNull();
    expect(newTask).not.toBe(existingTask);
  });

  it('returns null and logs error when the new cron schedule is invalid', async () => {
    const { rescheduleGuildKeepalive, mocks } = await setupMocks();
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);

    const result = rescheduleGuildKeepalive(
      {} as never,
      'guild-1',
      makeGuildConfig({ manufacturingKeepaliveCronSchedule: 'bad-cron' }),
    );

    expect(result).toBeNull();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('invalid cron schedule'),
      expect.any(Object),
    );
  });
});
