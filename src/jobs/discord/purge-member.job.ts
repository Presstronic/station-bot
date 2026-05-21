import cron from 'node-cron';
import type { Client, Guild } from 'discord.js';
import i18n from 'i18n';
import { getGuildConfigOrNull, type GuildConfig } from '../../domain/guild-config/guild-config.service.js';
import { getLogger } from '../../utils/logger.js';

const logger = getLogger();
const activeTasks = new Map<string, cron.ScheduledTask>();

function createNoOpTask(): cron.ScheduledTask {
  return {
    start() {
      return undefined;
    },
    stop() {
      return undefined;
    },
    destroy() {
      return undefined;
    },
  } as unknown as cron.ScheduledTask;
}

function buildTemporaryMemberKickMessage(guild: Guild, hoursToExpire: number): string {
  const locale = guild.preferredLocale?.substring(0, 2) || 'en';
  const cleanGuildName = guild.name.replace(/[^\w\s\-]/g, '');

  return i18n.__mf(
    { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
    {
      cleanGuildName,
      hoursToExpire: hoursToExpire.toString(),
    },
  );
}

function createTaskForGuild(
  client: Client,
  guildId: string,
  guildConfig: GuildConfig,
): cron.ScheduledTask {
  const task = cron.schedule(
    guildConfig.tempMemberPurgeCronSchedule,
    async () => {
      try {
        const currentGuildConfig = await getGuildConfigOrNull(guildId);

        if (currentGuildConfig === null) {
          logger.warn('[purge] Guild config unavailable or missing at tick time; skipping', { guildId });
          return;
        }

        if (!currentGuildConfig.purgeJobsEnabled) {
          logger.info('[purge] Purge disabled for guild at tick time; skipping', { guildId });
          return;
        }

        const guild = client.guilds.cache.get(guildId);
        if (!guild) {
          logger.warn('[purge] Guild not in client cache; skipping', { guildId });
          return;
        }

        const message = buildTemporaryMemberKickMessage(guild, currentGuildConfig.tempMemberHoursToExpire);
        const kicked = await purgeMembers(
          guild,
          currentGuildConfig.tempMemberRoleName,
          currentGuildConfig.tempMemberHoursToExpire,
          'TEMPORARY MEMBERS TIME LIMIT',
          message,
        );

        logger.info('[purge] Temporary member cleanup complete', {
          guildId,
          guildName: guild.name,
          kickedMembers: kicked,
        });
      } catch (error) {
        logger.error('[purge] Temporary member cleanup failed for guild', { guildId, error });
      }
    },
    { timezone: 'UTC' },
  );

  activeTasks.set(guildId, task);
  logger.info('[purge] Scheduled temporary member purge job for guild', {
    guildId,
    schedule: guildConfig.tempMemberPurgeCronSchedule,
    hoursToExpire: guildConfig.tempMemberHoursToExpire,
  });
  return task;
}

export async function purgeMembers(
  guild: Guild,
  roleName: string,
  hoursToExpire: number,
  purgeReason: string,
  purgeMessage: string,
): Promise<string[]> {
  const MEMBERS_KICKED: string[] = [];
  const expirationMs = hoursToExpire * 60 * 60 * 1000;

  try {
    await guild.members.fetch();
  } catch (err) {
    logger.error(`Could not fetch members for guild ${guild.name}:`, err);
    return MEMBERS_KICKED;
  }

  for (const member of guild.members.cache.values()) {
    const hasRole = member.roles.cache.some((role) => role.name === roleName);
    const joinedTime = member.joinedTimestamp ?? 0;
    const isOverExpiration = Date.now() - joinedTime > expirationMs;

    if (hasRole && (hoursToExpire === 0 || isOverExpiration)) {
      if (!member.kickable) {
        logger.warn(`Cannot kick ${member.user.tag} in ${guild.name}; insufficient permissions.`);
        continue;
      }

      try {
        await member.user.send(purgeMessage);
      } catch {
        logger.warn(`Could not DM ${member.user.tag} before kicking.`);
      }

      try {
        await member.kick(purgeReason);
        logger.info(`Kicked ${member.user.tag} from ${guild.name}: ${purgeReason}`);
        MEMBERS_KICKED.push(member.user.tag);
      } catch (error) {
        logger.error(`Error kicking ${member.user.tag}:`, error);
      }
    }
  }

  return MEMBERS_KICKED;
}

export function schedulePurgeJobs(
  client: Client,
  guildConfigs: GuildConfig[],
): Map<string, cron.ScheduledTask> {
  for (const config of guildConfigs) {
    const { guildId, tempMemberPurgeCronSchedule } = config;

    if (!config.purgeJobsEnabled) {
      activeTasks.get(guildId)?.stop();
      activeTasks.delete(guildId);
      continue;
    }

    if (!cron.validate(tempMemberPurgeCronSchedule)) {
      logger.error('[purge] Invalid cron schedule — job will not run', {
        guildId,
        tempMemberPurgeCronSchedule,
      });
      activeTasks.get(guildId)?.stop();
      activeTasks.delete(guildId);
      continue;
    }

    activeTasks.get(guildId)?.stop();
    createTaskForGuild(client, guildId, config);
  }

  const incomingIds = new Set(guildConfigs.map((config) => config.guildId));
  for (const [guildId, task] of activeTasks) {
    if (!incomingIds.has(guildId)) {
      task.stop();
      activeTasks.delete(guildId);
    }
  }

  return activeTasks;
}

export function rescheduleGuildPurge(
  client: Client,
  guildId: string,
  guildConfig: GuildConfig,
): cron.ScheduledTask {
  activeTasks.get(guildId)?.stop();
  activeTasks.delete(guildId);

  if (!guildConfig.purgeJobsEnabled) {
    logger.info('[purge] Purge disabled for guild; not rescheduling', { guildId });
    return createNoOpTask();
  }

  if (!cron.validate(guildConfig.tempMemberPurgeCronSchedule)) {
    logger.error('[purge] Invalid cron schedule for reschedule', {
      guildId,
      tempMemberPurgeCronSchedule: guildConfig.tempMemberPurgeCronSchedule,
    });
    return createNoOpTask();
  }

  return createTaskForGuild(client, guildId, guildConfig);
}
