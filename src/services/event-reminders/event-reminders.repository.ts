import { withClient } from '../nominations/db.js';

// Verifies the schema objects this feature depends on exist. Called at
// startup so an incomplete migration fails fast instead of producing
// confusing query errors at the first reminder tick.
export async function ensureEventRemindersSchema(): Promise<void> {
  await withClient(async (client) => {
    const tables = await client.query(`
      SELECT
        to_regclass('public.event_reminders') AS event_reminders_table,
        to_regclass('public.event_state') AS event_state_table
    `);
    const [tableRow] = tables.rows as { event_reminders_table: string | null; event_state_table: string | null }[];
    const missingTables = [
      tableRow?.event_reminders_table ? null : 'event_reminders',
      tableRow?.event_state_table ? null : 'event_state',
    ].filter((value): value is string => Boolean(value));
    if (missingTables.length > 0) {
      throw new Error(
        `Missing event-reminders schema objects (${missingTables.join(', ')}). Run database migrations before starting the bot.`
      );
    }

    const cols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'guild_configs'
    `);
    const guildConfigColumns = new Set<string>(
      cols.rows.map((row) => String((row as { column_name: string }).column_name)),
    );
    const required = [
      'event_reminders_enabled',
      'event_reminders_default_channel_id',
      'event_reminders_cron_schedule',
    ];
    const missingCols = required.filter((col) => !guildConfigColumns.has(col));
    if (missingCols.length > 0) {
      throw new Error(
        `Missing guild_configs columns for event reminders (${missingCols.join(', ')}). Run database migrations before starting the bot.`
      );
    }
  });
}

export interface EventStateRow {
  eventId: string;
  guildId: string;
  lastKnownStartTime: string;
}

export async function tryClaimReminder(
  guildId: string,
  eventId: string,
  reminderKey: string,
  channelId: string,
): Promise<boolean> {
  return withClient(async (client) => {
    const result = await client.query(
      `INSERT INTO event_reminders (guild_id, event_id, reminder_key, channel_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (event_id, reminder_key) DO NOTHING
       RETURNING id`,
      [guildId, eventId, reminderKey, channelId],
    );
    return result.rows.length > 0;
  });
}

export async function releaseReminderClaim(
  eventId: string,
  reminderKey: string,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `DELETE FROM event_reminders WHERE event_id = $1 AND reminder_key = $2`,
      [eventId, reminderKey],
    );
  });
}

export async function getEventState(eventId: string): Promise<EventStateRow | null> {
  return withClient(async (client) => {
    const result = await client.query(
      `SELECT event_id, guild_id, last_known_start_time
       FROM event_state
       WHERE event_id = $1`,
      [eventId],
    );
    if (result.rows.length === 0) return null;
    const row = result.rows[0] as Record<string, unknown>;
    return {
      eventId: String(row.event_id),
      guildId: String(row.guild_id),
      lastKnownStartTime: new Date(row.last_known_start_time as string | number | Date).toISOString(),
    };
  });
}

export async function upsertEventState(
  eventId: string,
  guildId: string,
  startTime: Date,
): Promise<void> {
  await withClient(async (client) => {
    await client.query(
      `INSERT INTO event_state (event_id, guild_id, last_known_start_time, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (event_id) DO UPDATE
         SET last_known_start_time = EXCLUDED.last_known_start_time,
             guild_id = EXCLUDED.guild_id,
             updated_at = NOW()`,
      [eventId, guildId, startTime.toISOString()],
    );
  });
}

// Deletes claim ledger rows older than the retention window. Returns the
// number of rows removed so the caller can log the cleanup result.
export async function deleteOldReminderClaims(retentionDays: number): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query(
      `DELETE FROM event_reminders WHERE sent_at < NOW() - ($1 || ' days')::interval`,
      [String(retentionDays)],
    );
    return result.rowCount ?? 0;
  });
}

// Deletes event_state rows whose tracked event start time is older than the
// retention window (i.e. the event has already happened and is no longer
// being polled). Orphaned rows from deleted events fall into this bucket.
export async function deleteOldEventState(retentionDays: number): Promise<number> {
  return withClient(async (client) => {
    const result = await client.query(
      `DELETE FROM event_state WHERE last_known_start_time < NOW() - ($1 || ' days')::interval`,
      [String(retentionDays)],
    );
    return result.rowCount ?? 0;
  });
}
