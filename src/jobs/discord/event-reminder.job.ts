import cron from 'node-cron';
import type { Client, Guild, GuildBasedChannel, GuildScheduledEvent } from 'discord.js';
import { ChannelType, GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';
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
function defangMentions(text: string): string {
  // Prevent event description text from escalating the intended tier mention.
  // allowedMentions.parse: ['everyone'] (required for @here/@everyone pings)
  // also activates any @everyone/@here that appears in the message content,
  // so an organiser could escalate a @here tier into an @everyone by embedding
  // it in the description. Replace both with their zero-width-space variants.
  return text.replace(/@everyone/g, '@​everyone').replace(/@here/g, '@​here');
}

function renderMessage(
  phrase: string,
  locale: string,
  body: string,
  // Other interpolation vars besides `eventBody` (eventTitle, startTime, etc.).
  staticVars: Record<string, string>,
): string {
  const safeBody = defangMentions(body);
  const baseVars = { ...staticVars, eventBody: '' };
  const baseLength = i18n.__mf({ phrase, locale }, baseVars).length;
  const budget = DISCORD_MAX_MESSAGE_LENGTH - baseLength;

  let finalBody: string;
  if (budget <= 0) {
    finalBody = '';
  } else if (safeBody.length <= budget) {
    finalBody = safeBody;
  } else {
    finalBody = safeBody.slice(0, budget - TRUNCATION_SUFFIX.length) + TRUNCATION_SUFFIX;
  }

  return i18n.__mf({ phrase, locale }, { ...staticVars, eventBody: finalBody });
}

// Voice/Stage events must NOT post into the event's own voice channel (its
// in-voice text chat is hidden from anyone not in the call). Instead, derive
// a regular text channel from the voice channel's name using a single
// guild-wide naming convention:
//   {prefix} Voice (or "{prefix} XYZ Voice") → first whitespace-delimited
//   token of the voice channel name, lowercased.
//   Target text channel name: starts with `{prefix}-` AND contains `general`.
// We require exactly one match; zero or multiple matches return null so the
// reminder is skipped (with a warning) rather than guessing — a wrong guess
// could leak org-only events into public channels.
export function matchTextChannelByVoiceName(
  voiceChannelName: string,
  textChannels: ReadonlyArray<{ id: string; name: string }>,
): { channelId: string } | { error: 'no-match' | 'ambiguous'; candidateIds: string[] } {
  const token = firstTokenOf(voiceChannelName);
  if (token.length === 0) {
    return { error: 'no-match', candidateIds: [] };
  }

  const prefix = `${token}-`;
  const candidates = textChannels.filter((channel) => {
    const lower = channel.name.toLowerCase();
    return lower.startsWith(prefix) && lower.includes('general');
  });

  if (candidates.length === 1) {
    return { channelId: candidates[0].id };
  }
  return {
    error: candidates.length === 0 ? 'no-match' : 'ambiguous',
    candidateIds: candidates.map((channel) => channel.id),
  };
}

function firstTokenOf(voiceChannelName: string): string {
  return voiceChannelName.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

// Public-tier voice channels start with this token (per the guild's naming
// convention — "SC Game Voice #1", "SC Testing Voice", etc.). Hardcoded
// because this bot is a single-guild deployment; revisit if we ever
// support a second guild with a different public prefix.
const PUBLIC_VOICE_TOKEN = 'sc';
const ORG_VOICE_TOKEN = 'org';

// allowedMentions shape Discord accepts on .send(). `everyone` covers both
// `@everyone` and `@here` (Discord treats them as the same parse permission).
// Role pings use an explicit allowlist by role id with no `parse: ['everyone']`.
export type ReminderAllowedMentions =
  | { parse: ['everyone'] }
  | { parse: []; roles: string[] };

export interface ResolvedMention {
  mention: string;
  allowedMentions: ReminderAllowedMentions;
}

// Resolve who to ping based on the voice channel's first token. Pure so it
// can be unit-tested without a discord.js Guild. The caller passes the set
// of guild roles (id + name) — the tier mention is:
//   - public token (`sc`): @everyone
//   - org token (`org`): the configured org member role (if any), else @here
//   - any other token: the guild role whose name equals the token
//     (case-insensitive), else @here as a graceful degradation.
export function resolveMentionForVoiceToken(
  token: string,
  orgMemberRoleId: string | null,
  guildRoles: ReadonlyArray<{ id: string; name: string }>,
): ResolvedMention {
  if (token === PUBLIC_VOICE_TOKEN) {
    return { mention: '@everyone', allowedMentions: { parse: ['everyone'] } };
  }
  if (token === ORG_VOICE_TOKEN) {
    if (orgMemberRoleId) {
      return { mention: `<@&${orgMemberRoleId}>`, allowedMentions: { parse: [], roles: [orgMemberRoleId] } };
    }
    return { mention: '@here', allowedMentions: { parse: ['everyone'] } };
  }
  const role = guildRoles.find((candidate) => candidate.name.toLowerCase() === token);
  if (role) {
    return { mention: `<@&${role.id}>`, allowedMentions: { parse: [], roles: [role.id] } };
  }
  return { mention: '@here', allowedMentions: { parse: ['everyone'] } };
}

interface ResolvedReminderTarget {
  channelId: string;
  mention: string;
  allowedMentions: ReminderAllowedMentions;
}

async function resolveVoiceEventTarget(
  guild: Guild,
  event: GuildScheduledEvent,
  orgMemberRoleId: string | null,
): Promise<ResolvedReminderTarget | null> {
  if (!event.channelId) {
    logger.warn('[event-reminder] Voice/stage event has no voice channel set; cannot resolve text channel', {
      guildId: guild.id,
      eventId: event.id,
    });
    return null;
  }

  const voiceChannel = await guild.client.channels.fetch(event.channelId).catch((error: unknown) => {
    logger.warn('[event-reminder] Failed to fetch voice channel for event', {
      guildId: guild.id,
      eventId: event.id,
      voiceChannelId: event.channelId,
      error,
    });
    return null;
  });

  if (!voiceChannel || !('name' in voiceChannel) || typeof voiceChannel.name !== 'string') {
    return null;
  }

  const textChannels: { id: string; name: string }[] = [];
  for (const channel of guild.channels.cache.values() as IterableIterator<GuildBasedChannel>) {
    if (channel.type === ChannelType.GuildText) {
      textChannels.push({ id: channel.id, name: channel.name });
    }
  }

  // Single token computation drives both channel and mention resolution to
  // ensure the two rules cannot disagree about which tier this event is in.
  const token = firstTokenOf(voiceChannel.name);

  const channelResult = matchTextChannelByVoiceName(voiceChannel.name, textChannels);
  if (!('channelId' in channelResult)) {
    logger.warn('[event-reminder] Could not resolve text channel from voice channel name', {
      guildId: guild.id,
      eventId: event.id,
      voiceChannelName: voiceChannel.name,
      reason: channelResult.error,
      candidateIds: channelResult.candidateIds,
    });
    return null;
  }

  const guildRoles: { id: string; name: string }[] = [];
  for (const role of guild.roles.cache.values()) {
    guildRoles.push({ id: role.id, name: role.name });
  }
  const mention = resolveMentionForVoiceToken(token, orgMemberRoleId, guildRoles);

  return {
    channelId: channelResult.channelId,
    mention: mention.mention,
    allowedMentions: mention.allowedMentions,
  };
}

async function resolveReminderTarget(
  guild: Guild,
  event: GuildScheduledEvent,
  guildConfig: GuildConfig,
): Promise<ResolvedReminderTarget | null> {
  const usesVoiceChannel =
    event.entityType === GuildScheduledEventEntityType.Voice ||
    event.entityType === GuildScheduledEventEntityType.StageInstance;

  if (usesVoiceChannel) {
    return resolveVoiceEventTarget(guild, event, guildConfig.orgMemberRoleId);
  }

  // External events: post to the configured default channel and ping
  // @everyone (the public-tier mention).
  if (!guildConfig.eventRemindersDefaultChannelId) return null;

  // Guard against stale configs that point at a voice/stage channel (e.g. set
  // before this PR via the old free-text modal). Posting into a voice channel's
  // embedded text surface would reintroduce the original bug.
  const defaultChannel = await guild.channels.fetch(guildConfig.eventRemindersDefaultChannelId).catch(() => null);
  if (!defaultChannel || defaultChannel.type !== ChannelType.GuildText) {
    logger.warn('[event-reminder] Configured default channel is not a GuildText channel; skipping external event', {
      guildId: guild.id,
      eventId: event.id,
      channelId: guildConfig.eventRemindersDefaultChannelId,
    });
    return null;
  }

  return {
    channelId: guildConfig.eventRemindersDefaultChannelId,
    mention: '@everyone',
    allowedMentions: { parse: ['everyone'] },
  };
}

// Type guard for channels we can post a reminder into. Pulled into a helper
// so it can be called before claiming the dedup row in event_reminders —
// otherwise an unreachable channel would cause a claim/release loop every
// tick and spam the log.
interface SendableChannel {
  send: (options: { content: string; allowedMentions: ReminderAllowedMentions }) => Promise<unknown>;
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
  allowedMentions: ReminderAllowedMentions,
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
      allowedMentions,
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
  resolvedTarget: ResolvedReminderTarget | null,
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

  if (!resolvedTarget) {
    logger.warn('[event-reminder] Reschedule notice skipped — no channel available', {
      guildId: guild.id,
      eventId: event.id,
    });
    return;
  }

  // Validate the channel BEFORE claiming the ledger row so an unreachable
  // channel cannot trigger a claim/release loop on every tick.
  const sendable = await resolveSendableChannel(guild, resolvedTarget.channelId);
  if (!sendable) return;

  const reminderKey = `reschedule-${Math.floor(startMs / 1000)}`;
  const claimed = await tryClaimReminder(guild.id, event.id, reminderKey, resolvedTarget.channelId);
  if (!claimed) return;

  const locale = parseLocale(guild.preferredLocale);
  const message = renderMessage(
    'jobs.eventReminders.messageRescheduled',
    locale,
    event.description ?? '',
    {
      mention: resolvedTarget.mention,
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, sendable, resolvedTarget.channelId, message, resolvedTarget.allowedMentions);
  if (!sent) {
    await releaseReminderClaim(event.id, reminderKey);
  }
}

async function handleReminderWindow(
  guild: Guild,
  event: GuildScheduledEvent,
  resolvedTarget: ResolvedReminderTarget | null,
  windowTarget: ReminderTarget,
  startMs: number,
  now: number,
): Promise<void> {
  const timeUntilStart = startMs - now;
  const drift = Math.abs(timeUntilStart - windowTarget.offsetMs);
  if (drift > TOLERANCE_MS) return;

  if (!resolvedTarget) {
    logger.warn('[event-reminder] Reminder skipped — no channel available', {
      guildId: guild.id,
      eventId: event.id,
      reminderKey: windowTarget.key,
    });
    return;
  }

  // Validate the channel BEFORE claiming the ledger row so an unreachable
  // channel cannot trigger a claim/release loop on every tick.
  const sendable = await resolveSendableChannel(guild, resolvedTarget.channelId);
  if (!sendable) return;

  const claimed = await tryClaimReminder(guild.id, event.id, windowTarget.key, resolvedTarget.channelId);
  if (!claimed) return;

  const locale = parseLocale(guild.preferredLocale);
  const message = renderMessage(
    REMINDER_PHRASE_KEY,
    locale,
    event.description ?? '',
    {
      mention: resolvedTarget.mention,
      hoursLabel: windowTarget.hoursLabel,
      eventTitle: event.name,
      startTime: formatStartTimeToken(startMs),
      eventLink: buildEventLink(guild.id, event.id),
    },
  );

  const sent = await postReminder(guild, sendable, resolvedTarget.channelId, message, resolvedTarget.allowedMentions);
  if (!sent) {
    await releaseReminderClaim(event.id, windowTarget.key);
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

    const now = Date.now();

    for (const event of events.values()) {
      if (event.status !== GuildScheduledEventStatus.Scheduled) {
        continue;
      }
      const startMs = event.scheduledStartTimestamp;
      if (startMs === null || startMs <= now) continue;

      // Resolve once per event per tick so voice-event resolution (cache scans
      // and potential channels.fetch calls) is not repeated for each handler.
      const resolvedTarget = await resolveReminderTarget(guild, event, guildConfig).catch((error: unknown) => {
        logger.warn('[event-reminder] Failed to resolve reminder target', { guildId, eventId: event.id, error });
        return null;
      });

      try {
        await handleRescheduleNotice(guild, event, resolvedTarget, startMs, now);
      } catch (error) {
        logger.warn('[event-reminder] Reschedule notice handler failed', { guildId, eventId: event.id, error });
      }

      for (const target of REMINDER_TARGETS) {
        try {
          await handleReminderWindow(guild, event, resolvedTarget, target, startMs, now);
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
