import cron from 'node-cron';
import type { Client, Guild, GuildScheduledEvent } from 'discord.js';
import { GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';
import i18n from '../../utils/i18n-config.js';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';
import { getGuildConfigOrNull } from '../../domain/guild-config/guild-config.service.js';
import {
  tryClaimReminder,
  releaseReminderClaim,
  getEventState,
  upsertEventState,
} from '../../services/event-reminders/event-reminders.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const activeTasks = new Map<string, cron.ScheduledTask>();

const HOUR_MS = 60 * 60 * 1000;
const TOLERANCE_MS = 15 * 60 * 1000;
const DISCORD_MAX_MESSAGE_LENGTH = 2000;
const TRUNCATION_SUFFIX = '…';

// Exported so tests can pin their boundary cases to the same value the
// production code uses, rather than hardcoding "30h" / "72h" that would
// silently drift if this window changes.
export const RESCHEDULE_NOTICE_WINDOW_MS = 48 * HOUR_MS;

// Single shared template for the 24h and 6h reminders. The wording is the
// same — only the hoursLabel parameter differs — so collapsing avoids two
// locale keys silently drifting apart.
const REMINDER_PHRASE_KEY = 'jobs.eventReminders.message';

// Pulls the primary language subtag from an IETF BCP-47 locale string.
// Using split keeps three-letter language codes intact (e.g. 'arq-DZ' →
// 'arq'), where a fixed substring would clip them to two characters.
function parseLocale(preferredLocale: string | null | undefined): string {
  if (!preferredLocale) return 'en';
  return preferredLocale.split('-')[0] || 'en';
}

interface ReminderTarget {
  key: '24h' | '6h';
  offsetMs: number;
  hoursLabel: string;
}

const REMINDER_TARGETS: ReminderTarget[] = [
  { key: '24h', offsetMs: 24 * HOUR_MS, hoursLabel: '24 hours' },
  { key: '6h',  offsetMs:  6 * HOUR_MS, hoursLabel: '6 hours' },
];

function formatStartTimeToken(unixMs: number): string {
  const unixSeconds = Math.floor(unixMs / 1000);
  return `<t:${unixSeconds}:F> (<t:${unixSeconds}:R>)`;
}

function buildEventLink(guildId: string, eventId: string): string {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

// Discord rejects message content longer than 2000 characters. The variable
// piece is the event description (eventBody); the prefix line and trailing
// event link are short and predictable. We render the i18n template twice:
// first with an empty body to measure the fixed overhead, then with a body
// truncated to fit the remaining budget. This preserves the trailing event
// link in all cases — both because we document that the link is always
// appended, and because Discord's event-card auto-embed only fires when the
// URL is present in the message content.
function renderMessage(
  phrase: string,
  locale: string,
  body: string,
  // Other interpolation vars besides `eventBody` (eventTitle, startTime, etc.).
  staticVars: Record<string, string>,
): string {
  const baseVars = { ...staticVars, eventBody: '' };
  const baseLength = i18n.__mf({ phrase, locale }, baseVars).length;
  const budget = DISCORD_MAX_MESSAGE_LENGTH - baseLength;

  let finalBody: string;
  if (budget <= 0) {
    finalBody = '';
  } else if (body.length <= budget) {
    finalBody = body;
  } else {
    finalBody = body.slice(0, budget - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
  }

  return i18n.__mf({ phrase, locale }, { ...staticVars, eventBody: finalBody });
}

function pickChannelId(event: GuildScheduledEvent, defaultChannelId: string | null): string | null {
  const usesVoiceChannel =
    event.entityType === GuildScheduledEventEntityType.Voice ||
    event.entityType === GuildScheduledEventEntityType.StageInstance;

  if (usesVoiceChannel && event.channelId) {
    return event.channelId;
  }
  return defaultChannelId;
}

// Type guard for channels we can post a reminder into. Pulled into a helper
// so it can be called before claiming the dedup row in event_reminders —
// otherwise an unreachable channel would cause a claim/release loop every
// tick and spam the log.
interface SendableChannel {
  send: (options: { content: string; allowedMentions: { parse: ['everyone'] } }) => Promise<unknown>;
}

async function resolveSendableChannel(
  guild: Guild,
  channelId: string,
): Promise<SendableChannel | null> {
  const channel = await guild.client.channels.fetch(channelId).catch((error: unknown) => {
    logger.warn('[event-reminder] Failed to fetch reminder channel', { guildId: guild.id, channelId, error });
    return null;
  });

  if (!channel) return null;

  if (!channel.isTextBased() || !('send' in channel)) {
    logger.warn('[event-reminder] Configured reminder channel is not text-based', { guildId: guild.id, channelId });
    return null;
  }

  return channel as unknown as SendableChannel;
}

async function postReminder(
  guild: Guild,
  channel: SendableChannel,
  channelId: string,
  message: string,
): Promise<boolean> {
  // Belt-and-suspenders: the two-pass renderMessage already keeps the message
  // within 2000 chars, but a future template edit could break that invariant.
  // A final length check here guarantees we never send oversize content.
  let finalContent = message;
  if (finalContent.length > DISCORD_MAX_MESSAGE_LENGTH) {
    logger.warn('[event-reminder] Rendered message exceeded Discord limit; truncating', {
      guildId: guild.id,
      channelId,
      renderedLength: finalContent.length,
    });
    finalContent = finalContent.slice(0, DISCORD_MAX_MESSAGE_LENGTH - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
  }

  try {
    await channel.send({
      content: finalContent,
      allowedMentions: { parse: ['everyone'] },
    });
    return true;
  } catch (error) {
    logger.warn('[event-reminder] Failed to send reminder', { guildId: guild.id, channelId, error });
    return false;
  }
}

async function handleRescheduleNotice(
  guild: Guild,
  event: GuildScheduledEvent,
  defaultChannelId: string | null,
  startMs: number,
  now: number,
): Promise<void> {
  const state = await getEventState(event.id);

  if (state === null) {
    await upsertEventState(event.id, guild.id, new Date(startMs));
    return;
  }

  const previousStartMs = new Date(state.lastKnownStartTime).getTime();
  if (previousStartMs === startMs) return;

  await upsertEventState(event.id, guild.id, new Date(startMs));

  if (startMs - now > RESCHEDULE_NOTICE_WINDOW_MS) return;

  const channelId = pickChannelId(event, defaultChannelId);
  if (!channelId) {
    logger.warn('[event-reminder] Reschedule notice skipped — no channel available', {
      guildId: guild.id,
      eventId: event.id,
    });
    return;
  }

  // Validate the channel BEFORE claiming the ledger row so an unreachable
  // channel cannot trigger a claim/release loop on every tick.
  const sendable = await resolveSendableChannel(guild, channelId);
  if (!sendable) return;

  const reminderKey = `reschedule-${Math.floor(startMs / 1000)}`;
  const claimed = await tryClaimReminder(guild.id, event.id, reminderKey, channelId);
  if (!claimed) return;

  const locale = parseLocale(guild.preferredLocale);
  const message = renderMessage(
    'jobs.eventReminders.messageRescheduled',
    locale,
    event.description ?? '',
    {
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, sendable, channelId, message);
  if (!sent) {
    await releaseReminderClaim(event.id, reminderKey);
  }
}

async function handleReminderWindow(
  guild: Guild,
  event: GuildScheduledEvent,
  defaultChannelId: string | null,
  target: ReminderTarget,
  startMs: number,
  now: number,
): Promise<void> {
  const timeUntilStart = startMs - now;
  const drift = Math.abs(timeUntilStart - target.offsetMs);
  if (drift > TOLERANCE_MS) return;

  const channelId = pickChannelId(event, defaultChannelId);
  if (!channelId) {
    logger.warn('[event-reminder] Reminder skipped — no channel available', {
      guildId: guild.id,
      eventId: event.id,
      reminderKey: target.key,
    });
    return;
  }

  // Validate the channel BEFORE claiming the ledger row so an unreachable
  // channel cannot trigger a claim/release loop on every tick.
  const sendable = await resolveSendableChannel(guild, channelId);
  if (!sendable) return;

  const claimed = await tryClaimReminder(guild.id, event.id, target.key, channelId);
  if (!claimed) return;

  const locale = parseLocale(guild.preferredLocale);
  const message = renderMessage(
    REMINDER_PHRASE_KEY,
    locale,
    event.description ?? '',
    {
      hoursLabel: target.hoursLabel,
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, sendable, channelId, message);
  if (!sent) {
    await releaseReminderClaim(event.id, target.key);
  }
}

async function runEventReminderTick(client: Client, guildId: string): Promise<void> {
  try {
    const guildConfig = await getGuildConfigOrNull(guildId);
    if (guildConfig === null) {
      logger.warn('[event-reminder] Guild config unavailable or missing at tick time; skipping', { guildId });
      return;
    }
    if (!guildConfig.eventRemindersEnabled) {
      logger.warn('[event-reminder] Event reminders disabled in guild config at tick time; skipping', { guildId });
      return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
      logger.warn('[event-reminder] Guild not in client cache; skipping tick', { guildId });
      return;
    }

    const events = await guild.scheduledEvents.fetch().catch((error: unknown) => {
      logger.warn('[event-reminder] Failed to fetch scheduled events', { guildId, error });
      return null;
    });
    if (!events) return;

    const defaultChannelId = guildConfig.eventRemindersDefaultChannelId;
    const now = Date.now();

    for (const event of events.values()) {
      if (event.status !== GuildScheduledEventStatus.Scheduled) {
        continue;
      }
      const startMs = event.scheduledStartTimestamp;
      if (startMs === null || startMs <= now) continue;

      try {
        await handleRescheduleNotice(guild, event, defaultChannelId, startMs, now);
      } catch (error) {
        logger.warn('[event-reminder] Reschedule notice handler failed', { guildId, eventId: event.id, error });
      }

      for (const target of REMINDER_TARGETS) {
        try {
          await handleReminderWindow(guild, event, defaultChannelId, target, startMs, now);
        } catch (error) {
          logger.warn('[event-reminder] Reminder window handler failed', {
            guildId,
            eventId: event.id,
            reminderKey: target.key,
            error,
          });
        }
      }
    }
  } catch (error) {
    logger.warn('[event-reminder] Unexpected error in event reminder tick', { guildId, error });
  }
}

function createTaskForGuild(client: Client, guildId: string, cronSchedule: string): cron.ScheduledTask {
  return cron.schedule(
    cronSchedule,
    () => runEventReminderTick(client, guildId),
    { timezone: 'UTC' },
  );
}

export function scheduleEventReminders(
  client: Client,
  guildConfigs: GuildConfig[],
): Map<string, cron.ScheduledTask> {
  for (const task of activeTasks.values()) task.stop();
  activeTasks.clear();

  for (const cfg of guildConfigs) {
    if (!cfg.eventRemindersEnabled) continue;

    const schedule = cfg.eventRemindersCronSchedule;
    if (!cron.validate(schedule)) {
      logger.error('[event-reminder] Invalid cron schedule for guild; skipping', {
        guildId: cfg.guildId,
        schedule,
      });
      continue;
    }

    const task = createTaskForGuild(client, cfg.guildId, schedule);
    activeTasks.set(cfg.guildId, task);
    logger.info(`[event-reminder] Scheduled event reminders for guild ${cfg.guildId}`, { schedule });
  }

  return activeTasks;
}

// Exposed for tests so the module-level activeTasks map can be cleared
// without relying on jest.resetModules() side effects. Tests can call this
// in afterEach to prevent leaks between cases.
export function resetEventRemindersForTests(): void {
  for (const task of activeTasks.values()) task.stop();
  activeTasks.clear();
}

export function rescheduleGuildEventReminders(
  client: Client,
  guildId: string,
  cronSchedule: string,
): cron.ScheduledTask | null {
  activeTasks.get(guildId)?.stop();
  activeTasks.delete(guildId);

  if (!cron.validate(cronSchedule)) {
    logger.error('[event-reminder] Invalid cron schedule; event reminders not rescheduled', { guildId, cronSchedule });
    return null;
  }

  const task = createTaskForGuild(client, guildId, cronSchedule);
  activeTasks.set(guildId, task);
  return task;
}
