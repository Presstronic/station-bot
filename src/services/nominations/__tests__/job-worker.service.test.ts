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
      getLogger: () => ({ info: jest.fn(), warn: warnSpy, error: jest.fn() }),
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
      jest.unstable_mockModule('../job-queue.repository.js', () => ({
        claimNextRunnableNominationCheckJob,
        claimNominationCheckJobItems,
        completeNominationCheckJobItem: jest.fn(),
        requeueNominationCheckJobItem,
        failNominationCheckJobItem,
        refreshNominationCheckJobProgress: jest.fn<() => Promise<any>>()
          .mockResolvedValueOnce({ status: 'running', completedCount: 0, failedCount: 0 }) // in-loop after batch 1
          .mockResolvedValueOnce({ status: 'running', completedCount: 0, failedCount: 0 }) // in-loop after batch 2
          .mockResolvedValueOnce({ status: 'failed', completedCount: 0, failedCount: 1 }), // final post-loop call
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
    } finally {
      if (envBackup === undefined) {
        delete process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
      } else {
        process.env.NOMINATION_WORKER_MAX_ATTEMPTS = envBackup;
      }
    }
  });
});
