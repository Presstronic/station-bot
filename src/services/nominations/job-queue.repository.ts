import type { PoolClient } from 'pg';
import { ensureNominationsSchema, isDatabaseConfigured, withClient } from './db.js';
import type {
  EnqueueNominationCheckJobResult,
  NominationCheckJob,
  NominationCheckJobItem,
  NominationCheckJobScope,
  NominationCheckJobStatus,
} from './job-types.js';
import { sanitizeForInlineText } from '../../utils/sanitize.js';

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for nomination job queue');
  }
}

function mapJobRow(row: any): NominationCheckJob {
  return {
    id: Number(row.id),
    createdByUserId: row.created_by_user_id,
    status: row.status,
    requestedScope: row.requested_scope,
    requestedHandle: row.requested_handle,
    totalCount: Number(row.total_count),
    completedCount: Number(row.completed_count),
    failedCount: Number(row.failed_count),
    pendingCount: Number(row.pending_count ?? Math.max(0, Number(row.total_count) - Number(row.completed_count) - Number(row.failed_count))),
    runningCount: Number(row.running_count ?? 0),
    errorSummary: row.error_summary,
    createdAt: new Date(row.created_at).toISOString(),
    startedAt: row.started_at ? new Date(row.started_at).toISOString() : null,
    finishedAt: row.finished_at ? new Date(row.finished_at).toISOString() : null,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapItemRow(row: any): NominationCheckJobItem {
  return {
    id: Number(row.id),
    jobId: Number(row.job_id),
    normalizedHandle: row.normalized_handle,
    status: row.status,
    attemptCount: Number(row.attempt_count),
    lastError: row.last_error,
    lockedAt: row.locked_at ? new Date(row.locked_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function getJobWithItemCounts(
  jobId: number,
  client?: PoolClient
): Promise<NominationCheckJob | null> {
  const query = (c: PoolClient) =>
    c.query(
      `
      SELECT
        j.*,
        COALESCE(SUM(CASE WHEN i.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN i.status = 'running' THEN 1 ELSE 0 END), 0) AS running_count
      FROM nomination_check_jobs j
      LEFT JOIN nomination_check_job_items i ON i.job_id = j.id
      WHERE j.id = $1
      GROUP BY j.id
      `,
      [jobId]
    );
  const result = client ? await query(client) : await withClient(query);
  if (result.rows.length === 0) {
    return null;
  }
  return mapJobRow(result.rows[0]);
}

export async function enqueueNominationCheckJob(
  createdByUserId: string,
  requestedScope: NominationCheckJobScope,
  normalizedHandles: string[],
  requestedHandle: string | null
): Promise<EnqueueNominationCheckJobResult> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const uniqueHandles = [...new Set(normalizedHandles.map((handle) => handle.trim().toLowerCase()).filter(Boolean))];
  if (uniqueHandles.length === 0) {
    throw new Error('Cannot enqueue nomination job without handles');
  }

  return withClient(async (client) => {
    await client.query('BEGIN');
    let committed = false;
    try {
      // Serialize concurrent enqueues for the same (scope, handle) pair.
      // FOR UPDATE only locks existing rows — it offers no protection when
      // the SELECT returns 0 rows. An advisory lock keyed by a 64-bit hash
      // (first 8 bytes of md5 of a prefix-encoded scope+handle string) is
      // held for the lifetime of the transaction, so a second concurrent
      // enqueue blocks here until the first commits or rolls back.
      // Prefix encoding ('scope:null' vs 'scope:handle:value') preserves
      // NULL distinctly, matching the IS NOT DISTINCT FROM predicate used
      // in the existence check. Hash collision risk is negligible given the
      // small set of distinct (scope, handle) values in practice.
      await client.query(
        `SELECT pg_advisory_xact_lock(
          ('x' || left(md5(CASE WHEN $2::text IS NULL THEN $1 || ':null' ELSE $1 || ':handle:' || $2::text END), 16))::bit(64)::bigint
        )`,
        [requestedScope, requestedHandle]
      );

      const existingResult = await client.query(
        `
        SELECT id
        FROM nomination_check_jobs
        WHERE status IN ('queued', 'running')
          AND requested_scope = $1
          AND requested_handle IS NOT DISTINCT FROM $2
        ORDER BY created_at DESC
        LIMIT 1
        `,
        [requestedScope, requestedHandle]
      );

      if (existingResult.rows.length > 0) {
        const existingJobId = Number(existingResult.rows[0].id);
        await client.query('COMMIT');
        committed = true;
        const job = await getJobWithItemCounts(existingJobId, client);
        if (!job) {
          throw new Error('Failed to load existing nomination check job');
        }
        return { job, reused: true };
      }

      const insertJobResult = await client.query(
        `
        INSERT INTO nomination_check_jobs (
          created_by_user_id,
          status,
          requested_scope,
          requested_handle,
          total_count,
          completed_count,
          failed_count,
          created_at,
          updated_at
        )
        VALUES ($1, 'queued', $2, $3, $4, 0, 0, NOW(), NOW())
        RETURNING id
        `,
        [createdByUserId, requestedScope, requestedHandle, uniqueHandles.length]
      );
      const jobId = Number(insertJobResult.rows[0].id);

      await client.query(
        `
        INSERT INTO nomination_check_job_items (
          job_id,
          normalized_handle,
          status,
          attempt_count,
          created_at,
          updated_at
        )
        SELECT $1, handle, 'pending', 0, NOW(), NOW()
        FROM unnest($2::text[]) AS handle
        `,
        [jobId, uniqueHandles]
      );

      await client.query('COMMIT');
      committed = true;
      const job = await getJobWithItemCounts(jobId, client);
      if (!job) {
        throw new Error('Failed to load created nomination check job');
      }
      return { job, reused: false };
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getNominationCheckJobById(jobId: number): Promise<NominationCheckJob | null> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();
  return getJobWithItemCounts(jobId);
}

export async function getLatestNominationCheckJob(): Promise<NominationCheckJob | null> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT id
      FROM nomination_check_jobs
      ORDER BY created_at DESC
      LIMIT 1
      `
    )
  );
  if (result.rows.length === 0) {
    return null;
  }
  return getJobWithItemCounts(Number(result.rows[0].id));
}

export async function claimNextRunnableNominationCheckJob(staleLockMs: number): Promise<NominationCheckJob | null> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  return withClient(async (client) => {
    await client.query('BEGIN');
    let committed = false;
    try {
      const claimResult = await client.query(
        `
        SELECT id
        FROM nomination_check_jobs j
        WHERE status IN ('queued', 'running')
          AND (
            status = 'queued'
            OR EXISTS (
              SELECT 1 FROM nomination_check_job_items i
              WHERE i.job_id = j.id
                AND i.status IN ('pending', 'running')
                AND (i.locked_at IS NULL OR i.locked_at < NOW() - ($1::numeric * interval '1 millisecond'))
            )
            OR NOT EXISTS (
              SELECT 1 FROM nomination_check_job_items i
              WHERE i.job_id = j.id
                AND i.status IN ('pending', 'running')
            )
          )
        ORDER BY created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
        `,
        [staleLockMs]
      );
      if (claimResult.rows.length === 0) {
        await client.query('COMMIT');
        committed = true;
        return null;
      }

      const jobId = Number(claimResult.rows[0].id);
      await client.query(
        `
        UPDATE nomination_check_jobs
        SET status = 'running',
            started_at = COALESCE(started_at, NOW()),
            updated_at = NOW()
        WHERE id = $1
        `,
        [jobId]
      );
      await client.query('COMMIT');
      committed = true;
      return getJobWithItemCounts(jobId, client);
    } catch (error) {
      if (!committed) await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function claimNominationCheckJobItems(
  jobId: number,
  limit: number,
  staleLockMs: number
): Promise<NominationCheckJobItem[]> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const safeLimit = Math.max(1, Math.floor(limit));
  const safeStaleLockMs = Math.max(1000, Math.floor(staleLockMs));

  const result = await withClient((client) =>
    client.query(
      `
      WITH claimable AS (
        SELECT id
        FROM nomination_check_job_items
        WHERE job_id = $1
          AND status IN ('pending', 'running')
          AND (
            locked_at IS NULL
            OR locked_at < (NOW() - ($3::numeric * interval '1 millisecond'))
          )
        ORDER BY updated_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT $2
      )
      UPDATE nomination_check_job_items i
      SET status = 'running',
          attempt_count = i.attempt_count + 1,
          updated_at = NOW(),
          locked_at = NOW()
      WHERE i.id IN (SELECT id FROM claimable)
      RETURNING i.*
      `,
      [jobId, safeLimit, safeStaleLockMs]
    )
  );

  return result.rows.map(mapItemRow);
}

export async function completeNominationCheckJobItem(itemId: number): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient((client) =>
    client.query(
      `
      UPDATE nomination_check_job_items
      SET status = 'completed',
          last_error = NULL,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [itemId]
    )
  );
}

export async function requeueNominationCheckJobItem(itemId: number, errorMessage: string): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient((client) =>
    client.query(
      `
      UPDATE nomination_check_job_items
      SET status = 'pending',
          last_error = $2,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [itemId, sanitizeForInlineText(errorMessage).slice(0, 350)]
    )
  );
}

export async function failNominationCheckJobItem(itemId: number, errorMessage: string): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient((client) =>
    client.query(
      `
      UPDATE nomination_check_job_items
      SET status = 'failed',
          last_error = $2,
          locked_at = NULL,
          updated_at = NOW()
      WHERE id = $1
      `,
      [itemId, sanitizeForInlineText(errorMessage).slice(0, 350)]
    )
  );
}

export async function refreshNominationCheckJobProgress(jobId: number): Promise<NominationCheckJob | null> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const countsResult = await client.query(
        `
        SELECT
          SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed_count,
          SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed_count,
          SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_count,
          SUM(CASE WHEN status = 'running' THEN 1 ELSE 0 END) AS running_count
        FROM nomination_check_job_items
        WHERE job_id = $1
        `,
        [jobId]
      );
      const countsRow = countsResult.rows[0];
      const completedCount = Number(countsRow?.completed_count ?? 0);
      const failedCount = Number(countsRow?.failed_count ?? 0);
      const pendingCount = Number(countsRow?.pending_count ?? 0);
      const runningCount = Number(countsRow?.running_count ?? 0);

      const status: NominationCheckJobStatus =
        pendingCount === 0 && runningCount === 0
          ? failedCount > 0
            ? 'failed'
            : 'completed'
          : 'running';

      const errorSummaryResult = await client.query(
        `
        SELECT normalized_handle, last_error
        FROM nomination_check_job_items
        WHERE job_id = $1
          AND status = 'failed'
        ORDER BY updated_at ASC
        LIMIT 5
        `,
        [jobId]
      );
      const errorSummary =
        errorSummaryResult.rows.length === 0
          ? null
          : errorSummaryResult.rows
              .map((row) => `${sanitizeForInlineText(row.normalized_handle)}: ${sanitizeForInlineText(String(row.last_error ?? 'unknown error'))}`)
              .join('; ')
              .slice(0, 900);

      await client.query(
        `
        UPDATE nomination_check_jobs
        SET status = $2,
            completed_count = $3,
            failed_count = $4,
            error_summary = $5,
            finished_at = CASE
              WHEN $2 IN ('completed', 'failed', 'cancelled') THEN COALESCE(finished_at, NOW())
              ELSE NULL
            END,
            updated_at = NOW()
        WHERE id = $1
        `,
        [jobId, status, completedCount, failedCount, errorSummary]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });

  return getJobWithItemCounts(jobId);
}
