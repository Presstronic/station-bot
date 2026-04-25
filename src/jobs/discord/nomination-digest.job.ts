import cron from 'node-cron';
import type { Client } from 'discord.js';
import type { GuildConfig } from '../../domain/guild-config/guild-config.service.js';
import { getGuildConfigOrNull } from '../../domain/guild-config/guild-config.service.js';
import { countUnprocessedNominations } from '../../services/nominations/nominations.repository.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const activeTasks = new Map<string, cron.ScheduledTask>();

function buildDigestMessage(roleId: string, count: number): string {
  if (count === 0) {
    return `<@&${roleId}> Daily nomination digest: there are currently no unprocessed nominations in the queue.`;
  }

  return `<@&${roleId}> Daily nomination digest: **${count}** unprocessed nomination(s) are currently in the queue.`;
}

function createTaskForGuild(client: Client, guildId: string, cronSchedule: string): cron.ScheduledTask {
  return cron.schedule(
    cronSchedule,
    async () => {
      const guildConfig = await getGuildConfigOrNull(guildId);

      if (!guildConfig?.nominationDigestEnabled) {
        logger.warn('[nomination-digest] Digest disabled for guild at tick time; skipping', { guildId });
        return;
      }

      const channelId = guildConfig.nominationDigestChannelId;
      const roleId = guildConfig.nominationDigestRoleId;

      if (!channelId || !roleId) {
        logger.warn('[nomination-digest] Guild config missing channel or role; skipping tick', { guildId });
        return;
      }

      const channel = await client.channels.fetch(channelId).catch((error: unknown) => {
        logger.warn('[nomination-digest] Failed to fetch digest channel', { guildId, channelId, error });
        return null;
      });

      if (!channel) {
        return;
      }

      if (!channel.isTextBased() || !('send' in channel)) {
        logger.warn('[nomination-digest] Configured digest channel is not text-based', { guildId, channelId });
        return;
      }

      try {
        const count = await countUnprocessedNominations();
        await channel.send({
          content: buildDigestMessage(roleId, count),
          allowedMentions: { roles: [roleId] },
        });
      } catch (error) {
        logger.warn('[nomination-digest] Failed to send daily nomination digest', { guildId, channelId, error });
      }
    },
    { timezone: 'UTC' },
  );
}

export function scheduleNominationDigests(
  client: Client,
  guildConfigs: GuildConfig[],
): Map<string, cron.ScheduledTask> {
  for (const cfg of guildConfigs) {
    if (!cfg.nominationDigestEnabled || !cfg.nominationDigestChannelId || !cfg.nominationDigestRoleId) {
      continue;
    }

    const schedule = cfg.nominationDigestCronSchedule;

    if (!cron.validate(schedule)) {
      logger.error('[nomination-digest] Invalid cron schedule for guild; skipping', {
        guildId: cfg.guildId,
        schedule,
      });
      continue;
    }

    activeTasks.get(cfg.guildId)?.stop();
    const task = createTaskForGuild(client, cfg.guildId, schedule);
    activeTasks.set(cfg.guildId, task);
    logger.info(`[nomination-digest] Scheduled digest for guild ${cfg.guildId}`, { schedule });
  }

  return activeTasks;
}

export function rescheduleGuildDigest(
  client: Client,
  guildId: string,
  cronSchedule: string,
): cron.ScheduledTask | null {
  activeTasks.get(guildId)?.stop();
  activeTasks.delete(guildId);

  if (!cron.validate(cronSchedule)) {
    logger.error('[nomination-digest] Invalid cron schedule; digest not rescheduled', { guildId, cronSchedule });
    return null;
  }

  const task = createTaskForGuild(client, guildId, cronSchedule);
  activeTasks.set(guildId, task);
  return task;
}
