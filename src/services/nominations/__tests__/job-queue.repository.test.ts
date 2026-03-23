import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeJobRow(id = 42) {
  return {
    id,
    created_by_user_id: 'user-1',
    status: 'queued',
    requested_scope: 'all',
    requested_handle: null,
    total_count: 1,
    completed_count: 0,
    failed_count: 0,
    pending_count: 1,
    running_count: 0,
    error_summary: null,
    created_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    updated_at: new Date().toISOString(),
  };
}

function makeWithClient(querySpy: jest.Mock) {
  return jest.fn(async (fn: (client: any) => Promise<any>) => fn({ query: querySpy }));
}

function queryCalls(query: jest.Mock): string[] {
  return (query.mock.calls as [string, ...unknown[]][]).map((c) => String(c[0]));
}

// ---------------------------------------------------------------------------
// enqueueNominationCheckJob — single pool checkout
// ---------------------------------------------------------------------------

describe('enqueueNominationCheckJob', () => {
  it('uses withClient exactly once when creating a new job (no nested checkout)', async () => {
    const jobRow = makeJobRow(42);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [] })            // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] })            // SELECT existing — none found
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // INSERT job RETURNING id
      .mockResolvedValueOnce({ rows: [] })            // INSERT items
      .mockResolvedValueOnce({ rows: [] })            // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });     // getJobWithItemCounts (reuses client)

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { enqueueNominationCheckJob } = await import('../job-queue.repository.js');
    const result = await enqueueNominationCheckJob('user-1', 'all', ['handle-a'], null);

    expect(withClient).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(false);
    expect(result.job.id).toBe(42);
  });

  it('uses withClient exactly once when reusing an existing job', async () => {
    const jobRow = makeJobRow(99);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [] })            // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [{ id: 99 }] }) // SELECT existing — found
      .mockResolvedValueOnce({ rows: [] })            // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });     // getJobWithItemCounts (reuses client)

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { enqueueNominationCheckJob } = await import('../job-queue.repository.js');
    const result = await enqueueNominationCheckJob('user-1', 'all', ['handle-a'], null);

    expect(withClient).toHaveBeenCalledTimes(1);
    expect(result.reused).toBe(true);
    expect(result.job.id).toBe(99);
  });

  it('does not issue ROLLBACK after a successful COMMIT when post-commit read fails', async () => {
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [] })            // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] })            // SELECT existing — none
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // INSERT job
      .mockResolvedValueOnce({ rows: [] })            // INSERT items
      .mockResolvedValueOnce({ rows: [] })            // COMMIT
      .mockRejectedValueOnce(new Error('read error')); // getJobWithItemCounts fails

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { enqueueNominationCheckJob } = await import('../job-queue.repository.js');
    await expect(enqueueNominationCheckJob('user-1', 'all', ['handle-a'], null)).rejects.toThrow('read error');

    const calls = queryCalls(query);
    expect(calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(false);
  });

  it('rolls back when an error occurs before COMMIT', async () => {
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockRejectedValueOnce(new Error('db error'))  // pg_advisory_xact_lock fails
      .mockResolvedValueOnce({ rows: [] });            // ROLLBACK

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { enqueueNominationCheckJob } = await import('../job-queue.repository.js');
    await expect(enqueueNominationCheckJob('user-1', 'all', ['handle-a'], null)).rejects.toThrow('db error');

    const calls = queryCalls(query);
    expect(calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
  });

  it('acquires a pg_advisory_xact_lock before the existence check to prevent concurrent duplicate enqueues', async () => {
    const jobRow = makeJobRow(42);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockResolvedValueOnce({ rows: [] })            // pg_advisory_xact_lock
      .mockResolvedValueOnce({ rows: [] })            // SELECT existing — none found
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // INSERT job
      .mockResolvedValueOnce({ rows: [] })            // INSERT items
      .mockResolvedValueOnce({ rows: [] })            // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });     // getJobWithItemCounts

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { enqueueNominationCheckJob } = await import('../job-queue.repository.js');
    await enqueueNominationCheckJob('user-1', 'all', ['handle-a'], null);

    const calls = queryCalls(query);
    const lockIdx = calls.findIndex((sql) => /pg_advisory_xact_lock/i.test(sql));
    const existenceIdx = calls.findIndex((sql) => /SELECT id.*FROM nomination_check_jobs/si.test(sql));
    expect(lockIdx).toBeGreaterThanOrEqual(0);
    expect(existenceIdx).toBeGreaterThan(lockIdx);
    // Regression: $2 must be cast to ::text so PostgreSQL can infer the type
    // when requestedHandle is NULL — without this the query fails at runtime.
    expect(calls[lockIdx]).toMatch(/\$2::text/);
  });
});

// ---------------------------------------------------------------------------
// claimNextRunnableNominationCheckJob — single pool checkout
// ---------------------------------------------------------------------------

describe('claimNextRunnableNominationCheckJob', () => {
  it('uses withClient exactly once when claiming a job (no nested checkout)', async () => {
    const jobRow = makeJobRow(7);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // SELECT claim
      .mockResolvedValueOnce({ rows: [] })           // UPDATE status
      .mockResolvedValueOnce({ rows: [] })           // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });    // getJobWithItemCounts (reuses client)

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    const result = await claimNextRunnableNominationCheckJob(300000);

    expect(withClient).toHaveBeenCalledTimes(1);
    expect(result?.id).toBe(7);
  });

  it('returns null and uses withClient once when no job is available', async () => {
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] }) // BEGIN
      .mockResolvedValueOnce({ rows: [] }) // SELECT claim — none
      .mockResolvedValueOnce({ rows: [] }); // COMMIT

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    const result = await claimNextRunnableNominationCheckJob(300000);

    expect(withClient).toHaveBeenCalledTimes(1);
    expect(result).toBeNull();
  });

  it('does not issue ROLLBACK after a successful COMMIT when post-commit read fails', async () => {
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // SELECT claim
      .mockResolvedValueOnce({ rows: [] })           // UPDATE
      .mockResolvedValueOnce({ rows: [] })           // COMMIT
      .mockRejectedValueOnce(new Error('read error')); // getJobWithItemCounts fails

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    await expect(claimNextRunnableNominationCheckJob(300000)).rejects.toThrow('read error');

    const calls = queryCalls(query);
    expect(calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(false);
  });

  it('rolls back when an error occurs before COMMIT', async () => {
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
      .mockRejectedValueOnce(new Error('db error'))  // SELECT claim fails
      .mockResolvedValueOnce({ rows: [] });            // ROLLBACK

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    await expect(claimNextRunnableNominationCheckJob(300000)).rejects.toThrow('db error');

    const calls = queryCalls(query);
    expect(calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
  });

  it('skips running jobs with no claimable items to prevent starvation after worker restart', async () => {
    const jobRow = makeJobRow(7);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 7 }] }) // SELECT claim
      .mockResolvedValueOnce({ rows: [] })           // UPDATE status
      .mockResolvedValueOnce({ rows: [] })           // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });    // getJobWithItemCounts

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    await claimNextRunnableNominationCheckJob(300000);

    const calls = queryCalls(query);
    const claimQuery = calls.find((sql) => /FOR UPDATE SKIP LOCKED/i.test(sql));
    // Running jobs excluded unless they have claimable items OR no non-terminal items
    expect(claimQuery).toMatch(/EXISTS.*nomination_check_job_items/si);
    expect(claimQuery).toMatch(/NOT EXISTS.*nomination_check_job_items/si);
    // Ordered purely by age — no static priority weighting
    expect(claimQuery).not.toMatch(/CASE WHEN status/i);
  });

  it('still claims a running job with no pending/running items so the worker can finalize it', async () => {
    // Scenario: worker A crashed after completing the last item but before
    // calling refreshNominationCheckJobProgress. All items are terminal
    // (completed/failed) but the job is still status='running'. Without this
    // path the job would be stuck in 'running' forever.
    const jobRow = { ...makeJobRow(9), status: 'running', pending_count: 0, running_count: 0 };
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })           // BEGIN
      .mockResolvedValueOnce({ rows: [{ id: 9 }] }) // SELECT claim — running job, no non-terminal items
      .mockResolvedValueOnce({ rows: [] })           // UPDATE status
      .mockResolvedValueOnce({ rows: [] })           // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });    // getJobWithItemCounts

    const withClient = makeWithClient(query);

    jest.unstable_mockModule('../db.js', () => ({
      isDatabaseConfigured: () => true,
      ensureNominationsSchema: jest.fn(async () => undefined),
      withClient,
    }));

    const { claimNextRunnableNominationCheckJob } = await import('../job-queue.repository.js');
    const result = await claimNextRunnableNominationCheckJob(300000);

    expect(withClient).toHaveBeenCalledTimes(1);
    expect(result?.id).toBe(9);
  });
});
