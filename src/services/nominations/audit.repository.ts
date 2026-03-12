import { ensureNominationsSchema, isDatabaseConfigured, withClient } from './db.ts';

export type AuditEventType =
  | 'nomination_access_role_added'
  | 'nomination_access_role_removed'
  | 'nomination_access_roles_reset'
  | 'nomination_processed_single'
  | 'nomination_processed_bulk'
  | 'nomination_check_refresh_triggered';

export interface NominationAuditEventInput {
  eventType: AuditEventType;
  actorUserId: string;
  actorUserTag: string;
  targetHandle?: string;
  targetRoleId?: string;
  payloadJson?: Record<string, unknown>;
  result: 'success' | 'failure';
  errorMessage?: string;
}

export interface AuditEvent extends NominationAuditEventInput {
  id: number;
  createdAt: string;
}

export interface GetAuditEventsOptions {
  eventType?: AuditEventType;
  since?: Date;
  limit?: number;
}

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for audit persistence');
  }
}

export async function recordAuditEvent(input: NominationAuditEventInput): Promise<void> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  await withClient((client) =>
    client.query(
      `
      INSERT INTO nomination_audit_events (
        event_type, actor_user_id, actor_user_tag,
        target_handle, target_role_id, payload_json,
        result, error_message, created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        input.eventType,
        input.actorUserId,
        input.actorUserTag,
        input.targetHandle ?? null,
        input.targetRoleId ?? null,
        input.payloadJson !== undefined ? JSON.stringify(input.payloadJson) : null,
        input.result,
        input.errorMessage ?? null,
      ]
    )
  );
}

export async function getAuditEvents(options: GetAuditEventsOptions = {}): Promise<AuditEvent[]> {
  assertDatabaseConfigured();
  await ensureNominationsSchema();

  const { eventType, since, limit } = options;
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (eventType !== undefined) {
    values.push(eventType);
    conditions.push(`event_type = $${values.length}`);
  }

  if (since !== undefined) {
    values.push(since.toISOString());
    conditions.push(`created_at > $${values.length}::timestamptz`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  let sql = `SELECT * FROM nomination_audit_events ${whereClause} ORDER BY created_at DESC`;
  if (limit !== undefined) {
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new Error(`Invalid limit: ${limit}`);
    }
    values.push(limit);
    sql += ` LIMIT $${values.length}`;
  }

  const result = await withClient((client) => client.query(sql, values));

  return result.rows.map((row) => ({
    id: Number(row.id),
    eventType: row.event_type as AuditEventType,
    actorUserId: row.actor_user_id,
    actorUserTag: row.actor_user_tag,
    targetHandle: row.target_handle ?? undefined,
    targetRoleId: row.target_role_id ?? undefined,
    payloadJson: row.payload_json ?? undefined,
    result: row.result as 'success' | 'failure',
    errorMessage: row.error_message ?? undefined,
    createdAt: new Date(row.created_at).toISOString(),
  }));
}
