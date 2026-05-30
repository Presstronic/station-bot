import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type CronCallback = () => Promise<void>;

beforeEach(() => {
  jest.resetModules();
});

async function setupMocks() {
  const warn = jest.fn();
  const error = jest.fn();
  const info = jest.fn();
  const deleteOldReminderClaims = jest.fn(async () => 0);
  const deleteOldEventState = jest.fn(async () => 0);

  let capturedCb: CronCallback | undefined;
  const cronStop = jest.fn();
  const cronSchedule = jest.fn((_schedule: string, cb: CronCallback) => {
    capturedCb = cb;
    return { stop: cronStop };
  });

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn, error, info, debug: jest.fn() }),
  }));

  jest.unstable_mockModule('../../../services/event-reminders/event-reminders.repository.js', () => ({
    deleteOldReminderClaims,
    deleteOldEventState,
    tryClaimReminder: jest.fn(),
    releaseReminderClaim: jest.fn(),
    getEventState: jest.fn(),
    upsertEventState: jest.fn(),
  }));

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn(() => true),
      schedule: cronSchedule,
    },
  }));

  return {
    warn, error, info,
    deleteOldReminderClaims,
    deleteOldEventState,
    cronSchedule,
    cronStop,
    runTick: async () => {
      if (!capturedCb) throw new Error('No tick callback captured');
      await capturedCb();
    },
  };
}

afterEach(async () => {
  // Best-effort reset so module-level state from one test does not leak.
  try {
    const mod = await import('../event-reminders-cleanup.job.js');
    mod.resetEventRemindersCleanupForTests();
  } catch {
    // module may not have been imported by this test — ignore.
  }
});

describe('scheduleEventRemindersCleanup', () => {
  it('schedules a task when cron schedule and retention days are valid', async () => {
    const setup = await setupMocks();
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    const task = scheduleEventRemindersCleanup('0 4 * * *', 30);

    expect(task).not.toBeNull();
    expect(setup.cronSchedule).toHaveBeenCalledTimes(1);
    expect(setup.info).toHaveBeenCalledWith(
      expect.stringContaining('Scheduled cleanup job'),
      expect.objectContaining({ retentionDays: 30 }),
    );
  });

  it('returns null and logs error when cron schedule is invalid', async () => {
    const setup = await setupMocks();
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    const task = scheduleEventRemindersCleanup('not-cron', 30);

    expect(task).toBeNull();
    expect(setup.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
  });

  it('returns null and logs error when retentionDays is non-positive', async () => {
    const setup = await setupMocks();
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    const task = scheduleEventRemindersCleanup('0 4 * * *', 0);

    expect(task).toBeNull();
    expect(setup.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid retentionDays'),
      expect.any(Object),
    );
  });

  it('stops the previous task when re-scheduled', async () => {
    const setup = await setupMocks();
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    scheduleEventRemindersCleanup('0 4 * * *', 30);
    scheduleEventRemindersCleanup('0 5 * * *', 60);

    expect(setup.cronStop).toHaveBeenCalledTimes(1);
    expect(setup.cronSchedule).toHaveBeenCalledTimes(2);
  });
});

describe('cleanup tick', () => {
  it('calls both delete helpers with the configured retention window', async () => {
    const setup = await setupMocks();
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    scheduleEventRemindersCleanup('0 4 * * *', 14);
    await setup.runTick();

    expect(setup.deleteOldReminderClaims).toHaveBeenCalledWith(14);
    expect(setup.deleteOldEventState).toHaveBeenCalledWith(14);
  });

  it('logs the row counts when deletions occur', async () => {
    const setup = await setupMocks();
    setup.deleteOldReminderClaims.mockResolvedValueOnce(5);
    setup.deleteOldEventState.mockResolvedValueOnce(2);
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    scheduleEventRemindersCleanup('0 4 * * *', 30);
    await setup.runTick();

    expect(setup.info).toHaveBeenCalledWith(
      expect.stringContaining('Removed stale rows'),
      expect.objectContaining({ reminderRows: 5, stateRows: 2 }),
    );
  });

  it('does not log when no rows were removed', async () => {
    const setup = await setupMocks();
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    scheduleEventRemindersCleanup('0 4 * * *', 30);
    await setup.runTick();

    expect(setup.info).not.toHaveBeenCalledWith(
      expect.stringContaining('Removed stale rows'),
      expect.any(Object),
    );
  });

  it('logs warn and does not throw when a delete helper rejects', async () => {
    const setup = await setupMocks();
    setup.deleteOldReminderClaims.mockRejectedValueOnce(new Error('DB down'));
    const { scheduleEventRemindersCleanup } = await import('../event-reminders-cleanup.job.js');

    scheduleEventRemindersCleanup('0 4 * * *', 30);
    await expect(setup.runTick()).resolves.not.toThrow();

    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cleanup tick failed'),
      expect.any(Object),
    );
  });
});
