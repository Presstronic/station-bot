import type { Client, GuildTextBasedChannel, VoiceBasedChannel } from 'discord.js';
import {
  claimDueStationTimers,
  completeStationTimer,
  createStationTimer,
  listActiveStationTimersForUser,
  resetStationTimerToActive,
  stopActiveStationTimerByUserSlot,
  type StationTimer,
  type StationTimerLabel,
} from '../../domain/station-timer/station-timer.repository.js';
import {
  STATION_TIMER_DEFAULT_MINUTES,
  stationTimerMaxActivePerGuild,
  stationTimerMaxActivePerUser,
} from '../../config/station-timer.config.js';
import { generateUuidV7 } from '../../utils/uuidv7.js';
import { getLogger } from '../../utils/logger.js';
import i18n from '../../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export type StationTimerStartResult =
  | { ok: true; timer: StationTimer }
  | { ok: false; reason: 'user-cap' | 'guild-cap' };

export interface StationTimerListItem {
  timer: StationTimer;
  remainingMinutes: number;
}

export async function startStationTimer(input: {
  guildId: string;
  discordUserId: string;
  starterDisplayName: string;
  timerLabel: StationTimerLabel;
  durationMinutes: number;
  now?: Date;
}): Promise<StationTimerStartResult> {
  const now = input.now ?? new Date();
  const dueAt = new Date(now.getTime() + input.durationMinutes * 60_000).toISOString();
  return createStationTimer({
    id: generateUuidV7(now),
    guildId: input.guildId,
    discordUserId: input.discordUserId,
    starterDisplayName: input.starterDisplayName,
    timerLabel: input.timerLabel,
    durationMinutes: input.durationMinutes,
    dueAt,
    maxActivePerGuild: stationTimerMaxActivePerGuild(),
    maxActivePerUser: stationTimerMaxActivePerUser(),
  });
}

export async function listStationTimersForUser(
  guildId: string,
  discordUserId: string,
  now = new Date(),
): Promise<StationTimerListItem[]> {
  const timers = await listActiveStationTimersForUser(guildId, discordUserId);
  return timers.map((timer) => ({
    timer,
    remainingMinutes: getRemainingMinutes(timer.dueAt, now),
  }));
}

export async function stopStationTimerForUser(
  guildId: string,
  discordUserId: string,
  userTimerId: number,
): Promise<StationTimer | null> {
  return stopActiveStationTimerByUserSlot(guildId, discordUserId, userTimerId);
}

export function getRemainingMinutes(dueAtIso: string, now = new Date()): number {
  const diffMs = new Date(dueAtIso).getTime() - now.getTime();
  if (diffMs <= 0) {
    return 0;
  }
  return Math.ceil(diffMs / 60_000);
}

function getLocale(client: Client, guildId: string): string {
  return client.guilds.cache.get(guildId)?.preferredLocale?.substring(0, 2) ?? defaultLocale;
}

async function sendVoiceChannelNotification(client: Client, timer: StationTimer, nowIso: string): Promise<string | null> {
  const guild = client.guilds.cache.get(timer.guildId);
  if (!guild) {
    return null;
  }

  try {
    // guild.members.fetch() does not populate the voice state cache, so
    // member.voice.channel would always be null for members already in voice
    // when the bot started. Fetch the voice state directly from the REST API
    // to get the current channel regardless of cache state.
    const voiceState = await guild.voiceStates.fetch(timer.discordUserId);
    const voiceChannel = voiceState.channel;
    if (!voiceChannel) {
      return null;
    }

    const member = voiceState.member ?? await guild.members.fetch(timer.discordUserId);

    const textChannel = voiceChannel as VoiceBasedChannel & Partial<GuildTextBasedChannel>;
    if (typeof textChannel.send !== 'function') {
      return null;
    }

    const locale = getLocale(client, timer.guildId);
    const fallbackContent = i18n.__mf(
      { phrase: 'commands.stationTimer.responses.expiry.channelFallback', locale },
      {
        displayName: member.displayName,
        durationMinutes: timer.durationMinutes,
        timerType: timer.timerLabel,
      },
    );

    try {
      await textChannel.send({
        content: i18n.__mf(
          { phrase: 'commands.stationTimer.responses.expiry.channel', locale },
          {
            displayName: member.displayName,
            durationMinutes: timer.durationMinutes,
            timerType: timer.timerLabel,
          },
        ),
        allowedMentions: { parse: ['everyone'] },
      });
    } catch (error) {
      logger.warn('[station-timer] Falling back to non-mention channel notification', {
        timerId: timer.id,
        guildId: timer.guildId,
        error,
      });
      await textChannel.send({
        content: fallbackContent,
        allowedMentions: { parse: [] },
      });
    }
    return nowIso;
  } catch (error) {
    logger.warn('[station-timer] Failed to send channel notification', {
      timerId: timer.id,
      guildId: timer.guildId,
      error,
    });
    return null;
  }
}

async function sendDirectMessage(client: Client, timer: StationTimer, nowIso: string): Promise<string | null> {
  try {
    const user = await client.users.fetch(timer.discordUserId);
    const locale = getLocale(client, timer.guildId);
    await user.send(
      i18n.__mf(
        { phrase: 'commands.stationTimer.responses.expiry.dm', locale },
        {
          durationMinutes: timer.durationMinutes,
          timerType: timer.timerLabel,
        },
      ),
    );
    return nowIso;
  } catch (error) {
    logger.warn('[station-timer] Failed to send DM notification', {
      timerId: timer.id,
      guildId: timer.guildId,
      error,
    });
    return null;
  }
}

export async function processDueStationTimers(client: Client, limit = 25): Promise<number> {
  const dueTimers = await claimDueStationTimers(limit);
  for (const timer of dueTimers) {
    const nowIso = new Date().toISOString();

    try {
      const dmSentAt = await sendDirectMessage(client, timer, nowIso);
      const channelNotificationSentAt = await sendVoiceChannelNotification(client, timer, nowIso);
      try {
        await completeStationTimer(timer.id, { dmSentAt, channelNotificationSentAt });
      } catch (error) {
        logger.error('[station-timer] Failed to persist completion after notifications', {
          timerId: timer.id,
          guildId: timer.guildId,
          error,
        });
        try {
          await resetStationTimerToActive(timer.id);
        } catch (resetError) {
          logger.error('[station-timer] Failed to reset timer to active after completion persistence failure', {
            timerId: timer.id,
            guildId: timer.guildId,
            error: resetError,
          });
        }
      }
    } catch (error) {
      logger.error('[station-timer] Unexpected due timer processing failure', {
        timerId: timer.id,
        guildId: timer.guildId,
        error,
      });
      await resetStationTimerToActive(timer.id);
    }
  }

  return dueTimers.length;
}

export function normalizeStationTimerMinutes(raw: number | null | undefined): number {
  if (raw == null) {
    return STATION_TIMER_DEFAULT_MINUTES;
  }
  return raw;
}
