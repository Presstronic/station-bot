import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BASE_CONFIG = {
  forumChannelId: 'forum-ch',
  staffChannelId: 'staff-ch',
  manufacturingRoleId: 'mfg-role',
  organizationMemberRoleId: 'org-role',
  orderLimit: 5,
  maxItemsPerOrder: 10,
  orderRateLimitPer5Min: 1,
  orderRateLimitPerHour: 5,
  createOrderPostTitle: '📋 Create Order',
  createOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
  createOrderThreadId: 'thread-123',
  keepAliveCronSchedule: '0 6 * * *',
};

type CronCallback = () => Promise<void>;

async function setupMocks(configOverrides: Partial<typeof BASE_CONFIG> = {}) {
  const config = { ...BASE_CONFIG, ...configOverrides };
  let capturedCallback: CronCallback | null = null;

  const mockWarn = jest.fn();
  const mockInfo = jest.fn();
  const mockDebug = jest.fn();
  const mockError = jest.fn();

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn: mockWarn, info: mockInfo, debug: mockDebug, error: mockError }),
  }));

  jest.unstable_mockModule('../../../config/manufacturing.config.js', () => ({
    getManufacturingConfig: () => config,
    isManufacturingEnabled: () => true,
    validateManufacturingConfig: () => [],
  }));

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn((_schedule: string) => true),
      schedule: jest.fn((_schedule: string, cb: CronCallback) => {
        capturedCallback = cb;
        return { stop: jest.fn() };
      }),
    },
  }));

  const { scheduleCreateOrderKeepAlive } = await import('../manufacturing-keepalive.job.js');

  return {
    scheduleCreateOrderKeepAlive,
    runJob: async () => {
      if (!capturedCallback) throw new Error('cron callback was not captured');
      await capturedCallback();
    },
    mocks: { warn: mockWarn, info: mockInfo, debug: mockDebug, error: mockError },
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
// scheduleCreateOrderKeepAlive
// ---------------------------------------------------------------------------

describe('scheduleCreateOrderKeepAlive', () => {
  it('calls setArchived(false) when the thread is archived', async () => {
    const { scheduleCreateOrderKeepAlive, runJob } = await setupMocks();
    const thread = makeThread(true);
    const client = makeClient(thread);

    scheduleCreateOrderKeepAlive(client as any);
    await runJob();

    expect(thread.setArchived).toHaveBeenCalledWith(false);
  });

  it('does not call setArchived when the thread is active', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks();
    const thread = makeThread(false);
    const client = makeClient(thread);

    scheduleCreateOrderKeepAlive(client as any);
    await runJob();

    expect(thread.setArchived).not.toHaveBeenCalled();
    expect(mocks.debug).toHaveBeenCalledWith(expect.stringContaining('active'));
  });

  it('warns and skips fetch when createOrderThreadId is blank', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks({ createOrderThreadId: '' });
    const client = makeClient();

    scheduleCreateOrderKeepAlive(client as any);
    await runJob();

    expect(client.channels.fetch).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('not set'));
  });

  it('warns when fetch returns null (thread not found or inaccessible)', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks();
    const client = makeClient(null);

    scheduleCreateOrderKeepAlive(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not found or is not accessible'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when fetched channel is not a thread', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks();
    const nonThread = { isThread: () => false, id: 'not-a-thread' };
    const client = makeClient(nonThread);

    scheduleCreateOrderKeepAlive(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('not a thread'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when channel fetch fails', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks();
    const client = {
      channels: {
        fetch: jest.fn(async () => { throw new Error('network error'); }),
      },
    };

    scheduleCreateOrderKeepAlive(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to fetch'),
      expect.any(Object),
    );
  });

  it('warns and exits without throwing when setArchived throws', async () => {
    const { scheduleCreateOrderKeepAlive, runJob, mocks } = await setupMocks();
    const thread = makeThread(true);
    (thread.setArchived as jest.Mock).mockImplementation(async () => { throw new Error('Missing Permissions'); });
    const client = makeClient(thread);

    scheduleCreateOrderKeepAlive(client as any);
    await expect(runJob()).resolves.not.toThrow();

    expect(mocks.warn).toHaveBeenCalledWith(
      expect.stringContaining('failed to unarchive'),
      expect.any(Object),
    );
  });

  it('logs an error and returns a stopped no-op task when the cron schedule is invalid', async () => {
    const { scheduleCreateOrderKeepAlive, mocks } = await setupMocks({
      keepAliveCronSchedule: 'not-a-valid-cron',
    });

    // Override the validate mock to return false for this test
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValue(false);

    const client = makeClient();
    const task = scheduleCreateOrderKeepAlive(client as any);

    expect(task).toBeDefined();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).toHaveBeenCalledWith(
      expect.stringContaining('invalid MANUFACTURING_KEEPALIVE_CRON_SCHEDULE'),
      expect.any(Object),
    );
  });
});
