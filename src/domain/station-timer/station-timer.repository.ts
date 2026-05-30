import { withClient, isDatabaseConfigured } from '../../services/nominations/db.js';

export type StationTimerLabel = 'CZ' | 'Hathor';
export type StationTimerStatus = 'active' | 'delivering' | 'completed' | 'stopped';

export interface StationTimer {
  id: string;
  guildId: string;
  discordUserId: string;
  userTimerId: number;
  starterDisplayName: string;
  timerLabel: StationTimerLabel;
  durationMinutes: number;
  dueAt: string;
  dmSentAt: string | null;
  channelNotificationSentAt: string | null;
  status: StationTimerStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CreateStationTimerInput {
  id: string;
  guildId: string;
  discordUserId: string;
  starterDisplayName: string;
  timerLabel: StationTimerLabel;
  durationMinutes: number;
  dueAt: string;
  maxActivePerGuild: number;
  maxActivePerUser: number;
}

export type CreateStationTimerResult =
  | { ok: true; timer: StationTimer }
  | { ok: false; reason: 'user-cap' | 'guild-cap' };

function assertDatabaseConfigured(): void {
  if (!isDatabaseConfigured()) {
    throw new Error('DATABASE_URL is required for station timers');
  }
}

function mapStationTimerRow(row: Record<string, unknown>): StationTimer {
  return {
    id: String(row.id),
    guildId: String(row.guild_id),
    discordUserId: String(row.discord_user_id),
    userTimerId: Number(row.user_timer_id),
    starterDisplayName: String(row.starter_display_name),
    timerLabel: String(row.timer_label) as StationTimerLabel,
    durationMinutes: Number(row.duration_minutes),
    dueAt: new Date(row.due_at as string | number | Date).toISOString(),
    dmSentAt: row.dm_sent_at != null ? new Date(row.dm_sent_at as string | number | Date).toISOString() : null,
    channelNotificationSentAt:
      row.channel_notification_sent_at != null
        ? new Date(row.channel_notification_sent_at as string | number | Date).toISOString()
        : null,
    status: String(row.status) as StationTimerStatus,
    createdAt: new Date(row.created_at as string | number | Date).toISOString(),
    updatedAt: new Date(row.updated_at as string | number | Date).toISOString(),
  };
}

async function withTransaction<T>(fn: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }> }) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function createStationTimer(input: CreateStationTimerInput): Promise<CreateStationTimerResult> {
  assertDatabaseConfigured();
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [4290, input.guildId]);
    await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [4291, `${input.guildId}:${input.discordUserId}`]);

    const userCountResult = await client.query(
      `SELECT COUNT(*)::int AS active_count
       FROM station_timers
       WHERE guild_id = $1
         AND discord_user_id = $2
         AND status = 'active'`,
      [input.guildId, input.discordUserId],
    );
    const userActiveCount = Number((userCountResult.rows[0] as Record<string, unknown>).active_count);
    if (userActiveCount >= input.maxActivePerUser) {
      return { ok: false, reason: 'user-cap' };
    }

    const guildCountResult = await client.query(
      `SELECT COUNT(*)::int AS active_count
       FROM station_timers
       WHERE guild_id = $1
         AND status = 'active'`,
      [input.guildId],
    );
    const guildActiveCount = Number((guildCountResult.rows[0] as Record<string, unknown>).active_count);
    if (guildActiveCount >= input.maxActivePerGuild) {
      return { ok: false, reason: 'guild-cap' };
    }

    const slotResult = await client.query(
      `SELECT slot
       FROM generate_series(1, $3) AS slot
       WHERE NOT EXISTS (
         SELECT 1
         FROM station_timers
         WHERE guild_id = $1
           AND discord_user_id = $2
           AND user_timer_id = slot
           AND status = 'active'
       )
       ORDER BY slot
       LIMIT 1`,
      [input.guildId, input.discordUserId, input.maxActivePerUser],
    );

    if (slotResult.rows.length === 0) {
      return { ok: false, reason: 'user-cap' };
    }

    const userTimerId = Number((slotResult.rows[0] as Record<string, unknown>).slot);
    const insertResult = await client.query(
      `INSERT INTO station_timers (
         id,
         guild_id,
         discord_user_id,
         user_timer_id,
         starter_display_name,
         timer_label,
         duration_minutes,
         due_at,
         status
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
       RETURNING *`,
      [
        input.id,
        input.guildId,
        input.discordUserId,
        userTimerId,
        input.starterDisplayName,
        input.timerLabel,
        input.durationMinutes,
        input.dueAt,
      ],
    );

    return {
      ok: true,
      timer: mapStationTimerRow(insertResult.rows[0] as Record<string, unknown>),
    };
  });
}

export async function listActiveStationTimersForUser(guildId: string, discordUserId: string): Promise<StationTimer[]> {
  assertDatabaseConfigured();
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT *
       FROM station_timers
       WHERE guild_id = $1
         AND discord_user_id = $2
         AND status = 'active'
       ORDER BY user_timer_id ASC`,
      [guildId, discordUserId],
    );
    return (result.rows as Record<string, unknown>[]).map(mapStationTimerRow);
  });
}

export async function stopActiveStationTimerByUserSlot(
  guildId: string,
  discordUserId: string,
  userTimerId: number,
): Promise<StationTimer | null> {
  assertDatabaseConfigured();
  return withTransaction(async (client) => {
    await client.query(`SELECT pg_advisory_xact_lock($1, hashtext($2))`, [4291, `${guildId}:${discordUserId}`]);
    const result = await client.query(
      `UPDATE station_timers
       SET status = 'stopped',
           updated_at = NOW()
       WHERE guild_id = $1
         AND discord_user_id = $2
         AND user_timer_id = $3
         AND status = 'active'
       RETURNING *`,
      [guildId, discordUserId, userTimerId],
    );
    if (result.rows.length === 0) {
      return null;
    }
    return mapStationTimerRow(result.rows[0] as Record<string, unknown>);
  });
}

export async function claimDueStationTimers(limit: number): Promise<StationTimer[]> {
  assertDatabaseConfigured();
  return withTransaction(async (client) => {
    const result = await client.query(
      `WITH due_rows AS (
         SELECT id
         FROM station_timers
         WHERE status = 'active'
           AND due_at <= NOW()
         ORDER BY due_at ASC
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       )
       UPDATE station_timers timers
       SET status = 'delivering',
           updated_at = NOW()
       FROM due_rows
       WHERE timers.id = due_rows.id
       RETURNING timers.*`,
      [limit],
    );
    return (result.rows as Record<string, unknown>[]).map(mapStationTimerRow);
  });
}

export async function completeStationTimer(
  id: string,
  delivery: { dmSentAt?: string | null; channelNotificationSentAt?: string | null },
): Promise<void> {
  assertDatabaseConfigured();
  await withClient(async (client) => {
    await client.query(
      `UPDATE station_timers
       SET status = 'completed',
           dm_sent_at = COALESCE($2::timestamptz, dm_sent_at),
           channel_notification_sent_at = COALESCE($3::timestamptz, channel_notification_sent_at),
           updated_at = NOW()
       WHERE id = $1`,
      [id, delivery.dmSentAt ?? null, delivery.channelNotificationSentAt ?? null],
    );
  });
}

export async function resetStationTimerToActive(id: string): Promise<void> {
  assertDatabaseConfigured();
  await withClient(async (client) => {
    await client.query(
      `UPDATE station_timers
       SET status = 'active',
           updated_at = NOW()
       WHERE id = $1
         AND status = 'delivering'`,
      [id],
    );
  });
}

export async function ensureStationTimersSchema(): Promise<void> {
  assertDatabaseConfigured();
  await withClient(async (client) => {
    const tableResult = await client.query<{ table_exists: string | null }>(
      `SELECT to_regclass('public.station_timers') AS table_exists`,
    );
    if (tableResult.rows[0].table_exists == null) {
      throw new Error('station_timers table not found — run database migrations before starting');
    }
  });
}
