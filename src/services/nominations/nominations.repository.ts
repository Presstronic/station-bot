import type { NominationEvent, NominationLifecycleState, NominationRecord, OrgCheckResult, OrgCheckStatus } from './types.js';
import { NominationTargetCapExceededError } from './types.js';
import { ensureNominationsSchema, isDatabaseConfigured, withClient } from './db.js';
import { reasonCodeMetadata } from './reason-codes.js';
import { assertValidTransition, deriveLifecycleStateFromOrgCheck } from './lifecycle.service.js';

export type { NominationLifecycleState };

export type NominationStatusFilter = Exclude<NominationLifecycleState, 'processed'>;

export type NominationSortOption = 'newest' | 'oldest' | 'nomination_count_desc';

export interface GetUnprocessedNominationsOptions {
  status?: NominationStatusFilter;
  sort?: NominationSortOption;
  limit?: number;
}

const SORT_CLAUSE_MAP: Record<NominationSortOption, string> = {
  newest:                'updated_at DESC',
  oldest:                'updated_at ASC',
  nomination_count_desc: 'nomination_count DESC, updated_at DESC',
};

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for nomination persistence');
  }
}

function assertOrgCheckResultConsistency(result: OrgCheckResult): void {
  const expectedStatus = reasonCodeMetadata[result.code].expectedStatus;
  if (result.status !== expectedStatus) {
    throw new Error(
      `Invalid org-check result consistency: code=${result.code}, status=${result.status}, expectedStatus=${expectedStatus}`
    );
  }
}

function mapDbRowToNomination(row: any, events: NominationEvent[]): NominationRecord {
  return {
    normalizedHandle: row.normalized_handle,
    displayHandle: row.display_handle,
    nominationCount: Number(row.nomination_count),
    lifecycleState: row.lifecycle_state as NominationLifecycleState,
    processedByUserId: row.processed_by_user_id,
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastOrgCheckStatus: row.last_org_check_status,
    lastOrgCheckResultCode: row.last_org_check_result_code,
    lastOrgCheckResultMessage: row.last_org_check_result_message,
    lastOrgCheckResultAt: row.last_org_check_result_at
      ? new Date(row.last_org_check_result_at).toISOString()
      : null,
    lastOrgCheckAt: row.last_org_check_at ? new Date(row.last_org_check_at).toISOString() : null,
    events,
  };
}

async function getEventsByHandles(normalizedHandles: string[]): Promise<Map<string, NominationEvent[]>> {
  const eventsByHandle = new Map<string, NominationEvent[]>();
  if (normalizedHandles.length === 0) {
    return eventsByHandle;
  }

  const result = await withClient((client) =>
    client.query(
      `
      SELECT normalized_handle, nominator_user_id, nominator_user_tag, reason, created_at
      FROM nomination_events
      WHERE normalized_handle = ANY($1::text[])
      ORDER BY created_at ASC
      `,
      [normalizedHandles]
    )
  );

  for (const row of result.rows) {
    const event: NominationEvent = {
      nominatorUserId: row.nominator_user_id,
      nominatorUserTag: row.nominator_user_tag,
      reason: row.reason,
      createdAt: new Date(row.created_at).toISOString(),
    };
    const existing = eventsByHandle.get(row.normalized_handle) || [];
    existing.push(event);
    eventsByHandle.set(row.normalized_handle, existing);
  }

  return eventsByHandle;
}

export { NominationTargetCapExceededError };

export async function recordNomination(
  rsiHandle: string,
  nominatorUserId: string,
  nominatorUserTag: string,
  reason: string | null,
  targetMaxPerDay = 0
): Promise<NominationRecord> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const normalizedHandle = normalizeHandle(rsiHandle);
  if (!normalizedHandle) {
    throw new Error('RSI handle is required for nomination');
  }

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      if (targetMaxPerDay > 0) {
        // Serialize concurrent nominations to the same target so the cap check
        // and the event write are atomic across requests from different users.
        // The lock is keyed by a 64-bit hash of the handle with a prefix to
        // avoid collisions with advisory locks from other parts of the codebase.
        await client.query(
          `SELECT pg_advisory_xact_lock(
            ('x' || left(md5('nomination_target:' || $1), 16))::bit(64)::bigint
          )`,
          [normalizedHandle]
        );

        const capResult = await client.query(
          `SELECT COUNT(*)::int AS event_count
           FROM nomination_events
           WHERE normalized_handle = $1
             AND created_at >= NOW() - ($2 * INTERVAL '1 second')`,
          [normalizedHandle, 86400]
        );
        if (Number(capResult.rows[0].event_count) >= targetMaxPerDay) {
          throw new NominationTargetCapExceededError(rsiHandle.trim());
        }
      }

      const existingRow = await client.query(
        `SELECT lifecycle_state FROM nominations WHERE normalized_handle = $1 FOR UPDATE`,
        [normalizedHandle]
      );
      const existingState = existingRow.rows[0]?.lifecycle_state as NominationLifecycleState | undefined;

      if (existingState === 'processed') {
        // Terminal state: row exists, just increment count and update display handle
        await client.query(
          `
          UPDATE nominations
          SET display_handle = $2,
              nomination_count = nomination_count + 1,
              updated_at = NOW()
          WHERE normalized_handle = $1
          `,
          [normalizedHandle, rsiHandle.trim()]
        );
      } else {
        await client.query(
          `
          INSERT INTO nominations (
            normalized_handle, display_handle, nomination_count, lifecycle_state,
            processed_by_user_id, processed_at, created_at, updated_at,
            last_org_check_status, last_org_check_result_code, last_org_check_result_message,
            last_org_check_result_at, last_org_check_at
          )
          VALUES ($1, $2, 1, 'new', NULL, NULL, NOW(), NOW(), NULL, NULL, NULL, NULL, NULL)
          ON CONFLICT (normalized_handle)
          DO UPDATE SET
            display_handle = EXCLUDED.display_handle,
            nomination_count = nominations.nomination_count + 1,
            lifecycle_state = 'new',
            processed_by_user_id = NULL,
            processed_at = NULL,
            updated_at = NOW()
          `,
          [normalizedHandle, rsiHandle.trim()]
        );
      }

      await client.query(
        `
        INSERT INTO nomination_events (
          normalized_handle, nominator_user_id, nominator_user_tag, reason, created_at
        )
        VALUES ($1, $2, $3, $4, NOW())
        `,
        [normalizedHandle, nominatorUserId, nominatorUserTag, reason]
      );

      const nominationResult = await client.query(
        `SELECT * FROM nominations WHERE normalized_handle = $1`,
        [normalizedHandle]
      );
      const eventsResult = await client.query(
        `
        SELECT nominator_user_id, nominator_user_tag, reason, created_at
        FROM nomination_events
        WHERE normalized_handle = $1
        ORDER BY created_at ASC
        `,
        [normalizedHandle]
      );

      await client.query('COMMIT');
      const events: NominationEvent[] = eventsResult.rows.map((eventRow) => ({
        nominatorUserId: eventRow.nominator_user_id,
        nominatorUserTag: eventRow.nominator_user_tag,
        reason: eventRow.reason,
        createdAt: new Date(eventRow.created_at).toISOString(),
      }));
      return mapDbRowToNomination(nominationResult.rows[0], events);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function getUnprocessedNominations(
  options: GetUnprocessedNominationsOptions = {}
): Promise<NominationRecord[]> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const { status, sort = 'newest', limit } = options;
  const conditions: string[] = ["lifecycle_state != 'processed'"];
  const values: unknown[] = [];

  if (status !== undefined) {
    values.push(status);
    conditions.push(`lifecycle_state = $${values.length}`);
  }

  if (!Object.prototype.hasOwnProperty.call(SORT_CLAUSE_MAP, sort)) {
    throw new Error(`Invalid sort option: ${sort}`);
  }

  let sql = `SELECT * FROM nominations WHERE ${conditions.join(' AND ')} ORDER BY ${SORT_CLAUSE_MAP[sort]}`;
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error(`Invalid limit: ${limit}`);
    }
    values.push(limit);
    sql += ` LIMIT $${values.length}`;
  }

  const nominationsResult = await withClient((client) => client.query(sql, values));

  const normalizedHandles = nominationsResult.rows.map((row) => row.normalized_handle as string);
  const eventsByHandle = await getEventsByHandles(normalizedHandles);
  return nominationsResult.rows.map((row) =>
    mapDbRowToNomination(row, eventsByHandle.get(row.normalized_handle) || [])
  );
}

export async function getUnprocessedNominationByHandle(rsiHandle: string): Promise<NominationRecord | null> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const normalizedHandle = normalizeHandle(rsiHandle);
  if (!normalizedHandle) {
    return null;
  }

  const nominationResult = await withClient((client) =>
    client.query(
      `
      SELECT *
      FROM nominations
      WHERE normalized_handle = $1
        AND lifecycle_state != 'processed'
      LIMIT 1
      `,
      [normalizedHandle]
    )
  );

  if (nominationResult.rows.length === 0) {
    return null;
  }

  const eventsByHandle = await getEventsByHandles([normalizedHandle]);
  return mapDbRowToNomination(
    nominationResult.rows[0],
    eventsByHandle.get(normalizedHandle) || []
  );
}

export async function updateOrgCheckResult(
  normalizedHandle: string,
  result: OrgCheckResult
): Promise<void> {
  assertDatabaseConfigured();
  assertOrgCheckResultConsistency(result);
  await ensureNominationsSchema();

  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const currentRow = await client.query(
        `SELECT lifecycle_state FROM nominations WHERE normalized_handle = $1 FOR UPDATE`,
        [normalizedHandle]
      );
      const currentState = currentRow.rows[0]?.lifecycle_state as NominationLifecycleState | undefined;

      if (!currentState || currentState === 'processed') {
        await client.query('ROLLBACK');
        return;
      }

      const newState = deriveLifecycleStateFromOrgCheck(result.code);
      assertValidTransition(currentState, newState);

      await client.query(
        `
        UPDATE nominations
        SET last_org_check_status = $2,
            last_org_check_result_code = $3,
            last_org_check_result_message = $4,
            last_org_check_result_at = $5::timestamptz,
            last_org_check_at = $5::timestamptz,
            lifecycle_state = $6,
            updated_at = NOW()
        WHERE normalized_handle = $1
        `,
        [normalizedHandle, result.status, result.code, result.message ?? null, result.checkedAt, newState]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function updateOrgCheckStatus(
  normalizedHandle: string,
  status: OrgCheckStatus
): Promise<void> {
  if (status === 'unknown') {
    assertDatabaseConfigured();
    await ensureNominationsSchema();

    await withClient(async (client) => {
      await client.query('BEGIN');
      try {
        const currentRow = await client.query(
          `SELECT lifecycle_state FROM nominations WHERE normalized_handle = $1 FOR UPDATE`,
          [normalizedHandle]
        );
        const currentState = currentRow.rows[0]?.lifecycle_state as NominationLifecycleState | undefined;

        if (!currentState || currentState === 'processed') {
          await client.query('ROLLBACK');
          return;
        }

        // 'unknown' status means a check ran but produced no definitive result
        const newState: NominationLifecycleState = 'checked';
        assertValidTransition(currentState, newState);

        await client.query(
          `
          UPDATE nominations
          SET last_org_check_status = $2,
              last_org_check_result_code = NULL,
              last_org_check_result_message = 'Legacy status-only update path',
              last_org_check_result_at = NULL,
              last_org_check_at = NOW(),
              lifecycle_state = $3,
              updated_at = NOW()
          WHERE normalized_handle = $1
          `,
          [normalizedHandle, status, newState]
        );

        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
    return;
  }

  await updateOrgCheckResult(normalizedHandle, {
    status,
    checkedAt: new Date().toISOString(),
    code: status === 'in_org' ? 'in_org' : 'not_in_org',
    message: 'Legacy status-only update path',
  });
}

export async function markNominationProcessedByHandle(
  rsiHandle: string,
  processedByUserId: string
): Promise<boolean> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const normalizedHandle = normalizeHandle(rsiHandle);
  const result = await withClient((client) =>
    client.query(
      `
      UPDATE nominations
      SET lifecycle_state = 'processed',
          processed_by_user_id = $2,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE normalized_handle = $1
        AND lifecycle_state != 'processed'
      `,
      [normalizedHandle, processedByUserId]
    )
  );

  return (result.rowCount ?? 0) > 0;
}

export async function markAllNominationsProcessed(processedByUserId: string): Promise<number> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      UPDATE nominations
      SET lifecycle_state = 'processed',
          processed_by_user_id = $1,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE lifecycle_state != 'processed'
      `,
      [processedByUserId]
    )
  );
  return result.rowCount ?? 0;
}

export async function getSecondsSinceLastNominationByUser(userId: string): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT EXTRACT(EPOCH FROM (NOW() - created_at))::int AS seconds_ago
      FROM nomination_events
      WHERE nominator_user_id = $1
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [userId]
    )
  );

  if (result.rows.length === 0) return null;
  return Number(result.rows[0].seconds_ago);
}

export async function countNominationsForTargetInWindow(
  normalizedHandle: string,
  windowSeconds: number
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT COUNT(*)::int AS event_count
      FROM nomination_events
      WHERE normalized_handle = $1
        AND created_at >= NOW() - ($2 * INTERVAL '1 second')
      `,
      [normalizedHandle, windowSeconds]
    )
  );

  return Number(result.rows[0].event_count);
}

export async function countNominationsByUserInWindow(
  userId: string,
  windowSeconds: number
): Promise<number> {
  if (!isDatabaseConfigured()) return 0;
  await ensureNominationsSchema();

  const result = await withClient((client) =>
    client.query(
      `
      SELECT COUNT(*)::int AS event_count
      FROM nomination_events
      WHERE nominator_user_id = $1
        AND created_at >= NOW() - ($2 * INTERVAL '1 second')
      `,
      [userId, windowSeconds]
    )
  );

  return Number(result.rows[0].event_count);
}
