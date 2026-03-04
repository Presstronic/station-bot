import type { NominationEvent, NominationRecord, OrgCheckStatus } from './types.ts';
import { ensureNominationsSchema, isDatabaseConfigured, withClient } from './db.ts';

function normalizeHandle(handle: string): string {
  return handle.trim().toLowerCase();
}

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for nomination persistence');
  }
}

function mapDbRowToNomination(row: any, events: NominationEvent[]): NominationRecord {
  return {
    normalizedHandle: row.normalized_handle,
    displayHandle: row.display_handle,
    nominationCount: Number(row.nomination_count),
    isProcessed: Boolean(row.is_processed),
    processedByUserId: row.processed_by_user_id,
    processedAt: row.processed_at ? new Date(row.processed_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    lastOrgCheckStatus: row.last_org_check_status,
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

export async function recordNomination(
  rsiHandle: string,
  nominatorUserId: string,
  nominatorUserTag: string,
  reason: string | null
): Promise<NominationRecord> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const normalizedHandle = normalizeHandle(rsiHandle);

  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      await client.query(
        `
        INSERT INTO nominations (
          normalized_handle, display_handle, nomination_count, is_processed,
          processed_by_user_id, processed_at, created_at, updated_at,
          last_org_check_status, last_org_check_at
        )
        VALUES ($1, $2, 1, FALSE, NULL, NULL, NOW(), NOW(), NULL, NULL)
        ON CONFLICT (normalized_handle)
        DO UPDATE SET
          display_handle = EXCLUDED.display_handle,
          nomination_count = nominations.nomination_count + 1,
          is_processed = FALSE,
          processed_by_user_id = NULL,
          processed_at = NULL,
          updated_at = NOW()
        `,
        [normalizedHandle, rsiHandle.trim()]
      );

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

export async function getUnprocessedNominations(): Promise<NominationRecord[]> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const nominationsResult = await withClient((client) =>
    client.query(
      `
      SELECT *
      FROM nominations
      WHERE is_processed = FALSE
      ORDER BY updated_at DESC
      `
    )
  );

  const normalizedHandles = nominationsResult.rows.map((row) => row.normalized_handle as string);
  const eventsByHandle = await getEventsByHandles(normalizedHandles);
  return nominationsResult.rows.map((row) =>
    mapDbRowToNomination(row, eventsByHandle.get(row.normalized_handle) || [])
  );
}

export async function updateOrgCheckStatus(
  normalizedHandle: string,
  status: OrgCheckStatus
): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient((client) =>
    client.query(
      `
      UPDATE nominations
      SET last_org_check_status = $2,
          last_org_check_at = NOW(),
          updated_at = NOW()
      WHERE normalized_handle = $1
      `,
      [normalizedHandle, status]
    )
  );
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
      SET is_processed = TRUE,
          processed_by_user_id = $2,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE normalized_handle = $1
        AND is_processed = FALSE
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
      SET is_processed = TRUE,
          processed_by_user_id = $1,
          processed_at = NOW(),
          updated_at = NOW()
      WHERE is_processed = FALSE
      `,
      [processedByUserId]
    )
  );
  return result.rowCount ?? 0;
}
