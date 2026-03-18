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
      .mockResolvedValueOnce({ rows: [] })          // BEGIN
      .mockResolvedValueOnce({ rows: [] })          // SELECT existing — none found
      .mockResolvedValueOnce({ rows: [{ id: 42 }] }) // INSERT job RETURNING id
      .mockResolvedValueOnce({ rows: [] })          // INSERT items
      .mockResolvedValueOnce({ rows: [] })          // COMMIT
      .mockResolvedValueOnce({ rows: [jobRow] });   // getJobWithItemCounts (reuses client)

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
      .mockRejectedValueOnce(new Error('db error'))  // SELECT existing fails
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

  it('uses FOR UPDATE on the existence check to prevent concurrent duplicate enqueues', async () => {
    const jobRow = makeJobRow(42);
    const query = jest.fn<() => Promise<{ rows: any[] }>>()
      .mockResolvedValueOnce({ rows: [] })            // BEGIN
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
    // The existence check is a plain SELECT ... FOR UPDATE (no SKIP LOCKED)
    const existenceCheck = calls.find((sql) => /FOR UPDATE/i.test(sql) && !/SKIP LOCKED/i.test(sql));
    expect(existenceCheck).toMatch(/FOR UPDATE/i);
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
    const result = await claimNextRunnableNominationCheckJob();

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
    const result = await claimNextRunnableNominationCheckJob();

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
    await expect(claimNextRunnableNominationCheckJob()).rejects.toThrow('read error');

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
    await expect(claimNextRunnableNominationCheckJob()).rejects.toThrow('db error');

    const calls = queryCalls(query);
    expect(calls.some((sql) => /ROLLBACK/i.test(sql))).toBe(true);
  });

  it('orders queued jobs before running jobs to prevent starvation after worker restart', async () => {
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
    await claimNextRunnableNominationCheckJob();

    const calls = queryCalls(query);
    const claimQuery = calls.find((sql) => /FOR UPDATE SKIP LOCKED/i.test(sql));
    expect(claimQuery).toMatch(/CASE WHEN status = 'queued' THEN 0/i);
  });
});
