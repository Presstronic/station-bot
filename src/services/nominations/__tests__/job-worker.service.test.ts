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

    jest.unstable_mockModule('../job-queue.repository.ts', () => ({
      claimNextRunnableNominationCheckJob,
      claimNominationCheckJobItems,
      completeNominationCheckJobItem,
      requeueNominationCheckJobItem: jest.fn(),
      failNominationCheckJobItem: jest.fn(),
      refreshNominationCheckJobProgress: jest.fn(async () => ({ status: 'completed', completedCount: 2, failedCount: 0 })),
    }));
    jest.unstable_mockModule('../org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));
    jest.unstable_mockModule('../nominations.repository.ts', () => ({
      updateOrgCheckResult,
    }));

    const { runNominationCheckWorkerCycle } = await import('../job-worker.service.ts');
    const ran = await runNominationCheckWorkerCycle();

    expect(ran).toBe(true);
    expect(claimNextRunnableNominationCheckJob).toHaveBeenCalledTimes(1);
    expect(checkHasAnyOrgMembership).toHaveBeenCalledTimes(2);
    expect(updateOrgCheckResult).toHaveBeenCalledTimes(2);
    expect(completeNominationCheckJobItem).toHaveBeenCalledTimes(2);
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

    jest.unstable_mockModule('../job-queue.repository.ts', () => ({
      claimNextRunnableNominationCheckJob,
      claimNominationCheckJobItems,
      completeNominationCheckJobItem: jest.fn(),
      requeueNominationCheckJobItem,
      failNominationCheckJobItem,
      refreshNominationCheckJobProgress: jest.fn(async () => ({ status: 'failed', completedCount: 0, failedCount: 1 })),
    }));
    jest.unstable_mockModule('../org-check.service.ts', () => ({
      checkHasAnyOrgMembership,
    }));
    jest.unstable_mockModule('../nominations.repository.ts', () => ({
      updateOrgCheckResult: jest.fn(),
    }));

    const { runNominationCheckWorkerCycle } = await import('../job-worker.service.ts');
    await runNominationCheckWorkerCycle();

    expect(requeueNominationCheckJobItem).toHaveBeenCalledTimes(1);
    expect(failNominationCheckJobItem).toHaveBeenCalledTimes(1);

    if (envBackup === undefined) {
      delete process.env.NOMINATION_WORKER_MAX_ATTEMPTS;
    } else {
      process.env.NOMINATION_WORKER_MAX_ATTEMPTS = envBackup;
    }
  });
});
