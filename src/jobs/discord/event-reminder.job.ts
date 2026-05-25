import cron from 'node-cron';
import type { Client, Guild, GuildScheduledEvent } from 'discord.js';
import { GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';
import i18n from 'i18n';
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
const RESCHEDULE_NOTICE_WINDOW_MS = 48 * HOUR_MS;

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

function pickChannelId(event: GuildScheduledEvent, defaultChannelId: string | null): string | null {
  const usesVoiceChannel =
    event.entityType === GuildScheduledEventEntityType.Voice ||
    event.entityType === GuildScheduledEventEntityType.StageInstance;

  if (usesVoiceChannel && event.channelId) {
    return event.channelId;
  }
  return defaultChannelId;
}

async function postReminder(
  guild: Guild,
  channelId: string,
  message: string,
): Promise<boolean> {
  const channel = await guild.client.channels.fetch(channelId).catch((error: unknown) => {
    logger.warn('[event-reminder] Failed to fetch reminder channel', { guildId: guild.id, channelId, error });
    return null;
  });

  if (!channel) return false;

  if (!channel.isTextBased() || !('send' in channel)) {
    logger.warn('[event-reminder] Configured reminder channel is not text-based', { guildId: guild.id, channelId });
    return false;
  }

  try {
    await channel.send({
      content: message,
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

  const reminderKey = `reschedule-${Math.floor(startMs / 1000)}`;
  const claimed = await tryClaimReminder(guild.id, event.id, reminderKey, channelId);
  if (!claimed) return;

  const locale = guild.preferredLocale?.substring(0, 2) || 'en';
  const message = i18n.__mf(
    { phrase: 'jobs.eventReminders.messageRescheduled', locale },
    {
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventBody: event.description ?? '',
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, channelId, message);
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

  const claimed = await tryClaimReminder(guild.id, event.id, target.key, channelId);
  if (!claimed) return;

  const locale = guild.preferredLocale?.substring(0, 2) || 'en';
  const phrase =
    target.key === '24h'
      ? 'jobs.eventReminders.message24h'
      : 'jobs.eventReminders.message6h';
  const message = i18n.__mf(
    { phrase, locale },
    {
      hoursLabel: target.hoursLabel,
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventBody: event.description ?? '',
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, channelId, message);
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
      if (
        event.status !== GuildScheduledEventStatus.Scheduled &&
        event.status !== GuildScheduledEventStatus.Active
      ) {
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
