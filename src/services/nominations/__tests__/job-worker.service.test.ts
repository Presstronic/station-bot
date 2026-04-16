import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('runNominationCheckWorkerCycle', () => {
  it('processes claimed job items and marks them completed', async () => {
    const claimNextRunnableNominationCheckJob = jest.fn(async () => ({
      id: 200,
      requestedScope: 'all',
      totalCount: 2,
    }));
    const claimNominationCheckJobItems = jest
      .fn<() => Promise<any[]>>()
      .mockImplementationOnce(async () => [
        { id: 1, normalizedHandle: 'pilotone', attemptCount: 1 },
        { id: 2, normalizedHandle: 'pilottwo', attemptCount: 1 },
      ])
      .mockImplementationOnce(async () => []);
    const checkHasAnyOrgMembership = jest.fn(async () => ({
      code: 'in_org',
      status: 'in_org',
      checkedAt: '2026-01-01T00:00:00.000Z',
    }));
    const updateOrgCheckResult = jest.fn(async () => undefined);
    const completeNominationCheckJobItem = jest.fn(async () => undefined);

    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob,
      claimNominationCheckJobItems,
      completeNominationCheckJobItem,
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(async () => ({ status: 'completed', completedCount: 2, failedCount: 0 })),
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership,
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult,
    }));

    const { runNominationCheckWorkerCycle } = await import('../job-worker.service.js');
    const ran = await runNominationCheckWorkerCycle();

    expect(ran).toBe(true);
    expect(claimNextRunnableNominationCheckJob).toHaveBeenCalledTimes(1);
    expect(claimNominationCheckJobItems).toHaveBeenCalledTimes(2);
    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(2);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(2);
    expect(completeNominationCheckJobItem).toHaveBeenCalledTimes(2);
  });

  it('breaks out of the batch loop after maxBatches iterations when items never drain', async () => {
    // Simulate a stuck queue where claimNominationCheckJobItems never returns empty.
    // With totalCount=1, batchSize=1, maxAttempts=3:
    //   maxBatches = ceil(1/1) * 3 + 2 = 5
    // The loop checks batchNumber >= maxBatches before incrementing, so it processes
    // exactly 5 batches (batchNumber reaches 5) and then breaks with a warning.
    const warnSpy = jest.fn();
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: warnSpy, error: jest.fn(), debug: jest.fn() }),
    }));

    const claimNextRunnableNominationCheckJob = jest.fn(async () => ({
      id: 300,
      requestedScope: 'all',
      totalCount: 1,
    }));
    const claimNominationCheckJobItems = jest.fn(async () => [
      { id: 99, normalizedHandle: 'stuckhandle', attemptCount: 1 },
    ]);
    const completeNominationCheckJobItem = jest.fn(async () => undefined);
    const refreshNominationCheckJobProgress = jest.fn(async () => ({
      status: 'running',
      completedCount: 0,
      failedCount: 0,
    }));

    const batchSizeBackup = process.env.NOMINATION_WORKER_BATCH_SIZE;
    const maxAttemptsBackup = process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
    process.env.NOMINATION_WORKER_BATCH_SIZE = '1';
    process.env.NOMINATION_WORKER_MAX_ATTEMPTS = '3';

    try {
      jest.unstable_mockModule('../job-queue.repository.js', () => ({
        claimNextRunnableNominationCheckJob,
        claimNominationCheckJobItems,
        completeNominationCheckJobItem,
        requeueNominationCheckJobItem: jest.fn(),
        failNominationCheckJobItem: jest.fn(),
        refreshNominationCheckJobProgress,
      }));
      jest.unstable_mockModule('../org-check.service.js', () => ({
        checkHasAnyOrgMembership: jest.fn(async () => ({
          code: 'in_org',
          status: 'in_org',
          checkedAt: '2026-01-01T00:00:00.000Z',
        })),
      }));
      jest.unstable_mockModule('../nominations.repository.js', () => ({
        updateOrgCheckResult: jest.fn(),
      }));

      const { runNominationCheckWorkerCycle } = await import('../job-worker.service.js');
      const ran = await runNominationCheckWorkerCycle();

      // maxBatches = ceil(1 / 1) * 3 + 2 = 5 — loop processes batches until
      // batchNumber reaches maxBatches (5), then the >= guard fires and breaks.
      // Two warnings are emitted: one from the cap guard, one from the end-of-cycle
      // cappedByLimit path (distinct from the "exhausted claimable items" info log).
      expect(claimNominationCheckJobItems).toHaveBeenCalledTimes(5);
      expect(refreshNominationCheckJobProgress).toHaveBeenCalledTimes(1);
      expect(ran).toBe(true);
      expect(warnSpy).toHaveBeenCalledTimes(2);
      // First warn: the cap guard
      expect(warnSpy.mock.calls[0][1]).toMatchObject({ jobId: 300, batchesProcessed: 5, maxBatches: 5 });
      // Second warn: end-of-cycle log indicating items remain and job stays running
      expect(warnSpy.mock.calls[1][1]).toMatchObject({ jobId: 300, status: 'running' });
    } finally {
      if (batchSizeBackup === undefined) {
        delete process.env.NOMINATION_WORKER_BATCH_SIZE;
      } else {
        process.env.NOMINATION_WORKER_BATCH_SIZE = batchSizeBackup;
      }
      if (maxAttemptsBackup === undefined) {
        delete process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
      } else {
        process.env.NOMINATION_WORKER_MAX_ATTEMPTS = maxAttemptsBackup;
      }
    }
  });

  it('requeues and then fails items once max attempts are reached', async () => {
    const claimNextRunnableNominationCheckJob = jest.fn(async () => ({
      id: 201,
      requestedScope: 'all',
      totalCount: 1,
    }));
    // With throttled refreshes, the queue drains before the next in-loop refresh
    // and the post-loop fallback refresh finalizes job status.
    const claimNominationCheckJobItems = jest
      .fn<() => Promise<any[]>>()
      .mockImplementationOnce(async () => [{ id: 1, normalizedHandle: 'pilotone', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 1, normalizedHandle: 'pilotone', attemptCount: 3 }])
      .mockImplementationOnce(async () => []);
    const checkHasAnyOrgMembership = jest.fn(async () => {
      throw new Error('transient');
    });
    const requeueNominationCheckJobItem = jest.fn(async () => undefined);
    const failNominationCheckJobItem = jest.fn(async () => undefined);

    const envBackup = process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
    process.env.NOMINATION_WORKER_MAX_ATTEMPTS = '3';

    try {
      jest.unstable_mockModule('../../../utils/logger.js', () => ({
        getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
      }));
      jest.unstable_mockModule('../job-queue.repository.js', () => ({
        claimNextRunnableNominationCheckJob,
        claimNominationCheckJobItems,
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem,
      failNominationCheckJobItem,
      refreshNominationCheckJobProgress: jest.fn<() => Promise<any>>()
          .mockResolvedValueOnce({ status: 'failed', completedCount: 0, failedCount: 1 }),  // post-loop fallback after queue drain
      }));
      jest.unstable_mockModule('../org-check.service.js', () => ({
        checkHasAnyOrgMembership,
      }));
      jest.unstable_mockModule('../nominations.repository.js', () => ({
        updateOrgCheckResult: jest.fn(),
      }));

      const { runNominationCheckWorkerCycle } = await import('../job-worker.service.js');
      await runNominationCheckWorkerCycle();

      expect(requeueNominationCheckJobItem).toHaveBeenCalledTimes(1);
      expect(failNominationCheckJobItem).toHaveBeenCalledTimes(1);
      expect(claimNominationCheckJobItems).toHaveBeenCalledTimes(3);
    } finally {
      if (envBackup === undefined) {
        delete process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
      } else {
        process.env.NOMINATION_WORKER_MAX_ATTEMPTS = envBackup;
      }
    }
  });

  it('reuses the in-loop refresh when batch 5 reports a terminal status', async () => {
    const claimNextRunnableNominationCheckJob = jest.fn(async () => ({
      id: 202,
      requestedScope: 'all',
      totalCount: 5,
    }));
    const claimNominationCheckJobItems = jest
      .fn<() => Promise<any[]>>()
      .mockImplementationOnce(async () => [{ id: 1, normalizedHandle: 'pilot1', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 2, normalizedHandle: 'pilot2', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 3, normalizedHandle: 'pilot3', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 4, normalizedHandle: 'pilot4', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 5, normalizedHandle: 'pilot5', attemptCount: 1 }]);
    const refreshNominationCheckJobProgress = jest
      .fn<() => Promise<any>>()
      .mockResolvedValue({ status: 'completed', completedCount: 5, failedCount: 0 });

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob,
      claimNominationCheckJobItems,
      completeNominationCheckJobItem: jest.fn(async () => undefined),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress,
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(async () => ({
        code: 'in_org',
        status: 'in_org',
        checkedAt: '2026-01-01T00:00:00.000Z',
      })),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(async () => undefined),
    }));

    const batchSizeBackup = process.env.NOMINATION_WORKER_BATCH_SIZE;
    process.env.NOMINATION_WORKER_BATCH_SIZE = '1';

    try {
      const { runNominationCheckWorkerCycle } = await import('../job-worker.service.js');
      await runNominationCheckWorkerCycle();

      expect(claimNominationCheckJobItems).toHaveBeenCalledTimes(5);
      expect(refreshNominationCheckJobProgress).toHaveBeenCalledTimes(1);
    } finally {
      if (batchSizeBackup === undefined) {
        delete process.env.NOMINATION_WORKER_BATCH_SIZE;
      } else {
        process.env.NOMINATION_WORKER_BATCH_SIZE = batchSizeBackup;
      }
    }
  });

  it('forces a final refresh when the last cached progress is stale', async () => {
    const claimNextRunnableNominationCheckJob = jest.fn(async () => ({
      id: 203,
      requestedScope: 'all',
      totalCount: 6,
    }));
    const claimNominationCheckJobItems = jest
      .fn<() => Promise<any[]>>()
      .mockImplementationOnce(async () => [{ id: 1, normalizedHandle: 'pilot1', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 2, normalizedHandle: 'pilot2', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 3, normalizedHandle: 'pilot3', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 4, normalizedHandle: 'pilot4', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 5, normalizedHandle: 'pilot5', attemptCount: 1 }])
      .mockImplementationOnce(async () => [{ id: 6, normalizedHandle: 'pilot6', attemptCount: 1 }])
      .mockImplementationOnce(async () => []);
    const refreshNominationCheckJobProgress = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 'running', completedCount: 5, failedCount: 0 })
      .mockResolvedValueOnce({ status: 'completed', completedCount: 6, failedCount: 0 });

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob,
      claimNominationCheckJobItems,
      completeNominationCheckJobItem: jest.fn(async () => undefined),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress,
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(async () => ({
        code: 'in_org',
        status: 'in_org',
        checkedAt: '2026-01-01T00:00:00.000Z',
      })),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(async () => undefined),
    }));

    const batchSizeBackup = process.env.NOMINATION_WORKER_BATCH_SIZE;
    process.env.NOMINATION_WORKER_BATCH_SIZE = '1';

    try {
      const { runNominationCheckWorkerCycle } = await import('../job-worker.service.js');
      await runNominationCheckWorkerCycle();

      expect(claimNominationCheckJobItems).toHaveBeenCalledTimes(7);
      expect(refreshNominationCheckJobProgress).toHaveBeenCalledTimes(2);
    } finally {
      if (batchSizeBackup === undefined) {
        delete process.env.NOMINATION_WORKER_BATCH_SIZE;
      } else {
        process.env.NOMINATION_WORKER_BATCH_SIZE = batchSizeBackup;
      }
    }
  });
});

describe('startNominationCheckWorkerLoop', () => {
  it('logs when NOMINATION_WORKER_ENABLED is unset and defaults to disabled', async () => {
    const enabledBackup = process.env.NOMINATION_WORKER_ENABLED;
    delete process.env.NOMINATION_WORKER_ENABLED;

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => logger,
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob: jest.fn(),
      claimNominationCheckJobItems: jest.fn(),
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(),
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(),
    }));

    try {
      const { startNominationCheckWorkerLoop } = await import('../job-worker.service.js');
      const interval = startNominationCheckWorkerLoop();

      expect(interval).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'Nomination worker disabled - NOMINATION_WORKER_ENABLED is not set (defaulting to disabled).'
      );
    } finally {
      if (enabledBackup === undefined) {
        delete process.env.NOMINATION_WORKER_ENABLED;
      } else {
        process.env.NOMINATION_WORKER_ENABLED = enabledBackup;
      }
    }
  });

  it('logs the raw falsy NOMINATION_WORKER_ENABLED value when disabled explicitly', async () => {
    const enabledBackup = process.env.NOMINATION_WORKER_ENABLED;
    process.env.NOMINATION_WORKER_ENABLED = 'false';

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => logger,
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob: jest.fn(),
      claimNominationCheckJobItems: jest.fn(),
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(),
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(),
    }));

    try {
      const { startNominationCheckWorkerLoop } = await import('../job-worker.service.js');
      const interval = startNominationCheckWorkerLoop();

      expect(interval).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        'Nomination worker disabled - NOMINATION_WORKER_ENABLED=false (parsed as disabled).'
      );
    } finally {
      if (enabledBackup === undefined) {
        delete process.env.NOMINATION_WORKER_ENABLED;
      } else {
        process.env.NOMINATION_WORKER_ENABLED = enabledBackup;
      }
    }
  });

  it('sanitizes unrecognized NOMINATION_WORKER_ENABLED values in the disabled log', async () => {
    const enabledBackup = process.env.NOMINATION_WORKER_ENABLED;
    process.env.NOMINATION_WORKER_ENABLED = 'maybe\nline|two`three';

    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => logger,
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob: jest.fn(),
      claimNominationCheckJobItems: jest.fn(),
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(),
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(),
    }));

    try {
      const { startNominationCheckWorkerLoop } = await import('../job-worker.service.js');
      const interval = startNominationCheckWorkerLoop();

      expect(interval).toBeNull();
      expect(logger.info).toHaveBeenCalledWith(
        "Nomination worker disabled - NOMINATION_WORKER_ENABLED=maybe line/two'three (unrecognized value, defaulting to disabled)."
      );
    } finally {
      if (enabledBackup === undefined) {
        delete process.env.NOMINATION_WORKER_ENABLED;
      } else {
        process.env.NOMINATION_WORKER_ENABLED = enabledBackup;
      }
    }
  });

  it('sanitizes cycle-level catch log output', async () => {
    const enabledBackup = process.env.NOMINATION_WORKER_ENABLED;
    const pollMsBackup = process.env.NOMINATION_WORKER_POLL_MS;
    process.env.NOMINATION_WORKER_ENABLED = 'true';
    process.env.NOMINATION_WORKER_POLL_MS = '60000';

    const error = new Error('boom\nline|two`three');
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => logger,
    }));
    jest.unstable_mockModule('../job-queue.repository.js', () => ({
      claimNextRunnableNominationCheckJob: jest.fn(async () => {
        throw error;
      }),
      claimNominationCheckJobItems: jest.fn(),
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(),
    }));
    jest.unstable_mockModule('../org-check.service.js', () => ({
      checkHasAnyOrgMembership: jest.fn(),
    }));
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      updateOrgCheckResult: jest.fn(),
    }));

    let interval: NodeJS.Timeout | null = null;
    try {
      const { startNominationCheckWorkerLoop } = await import('../job-worker.service.js');
      interval = startNominationCheckWorkerLoop();

      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(logger.error).toHaveBeenCalledWith(
        "Nomination worker cycle failed: Error: boom line/two'three"
      );
    } finally {
      if (interval) {
        clearInterval(interval);
      }

      if (enabledBackup === undefined) {
        delete process.env.NOMINATION_WORKER_ENABLED;
      } else {
        process.env.NOMINATION_WORKER_ENABLED = enabledBackup;
      }

      if (pollMsBackup === undefined) {
        delete process.env.NOMINATION_WORKER_POLL_MS;
      } else {
        process.env.NOMINATION_WORKER_POLL_MS = pollMsBackup;
      }
    }
  });
});
