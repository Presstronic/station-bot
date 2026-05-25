import { withClient } from '../nominations/db.js';

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
