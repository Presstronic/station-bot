import cron from 'node-cron';
import { Client, Guild } from 'discord.js';
import { getLogger } from '../../utils/logger.js';
import i18n from 'i18n';
import { getGuildConfigOrNull, type GuildConfig } from '../../domain/guild-config/guild-config.service.js';

const logger = getLogger();

const activeTasks = new Map<string, cron.ScheduledTask>();

const NO_OP_TASK = { stop: () => {} } as unknown as cron.ScheduledTask;

export async function purgeMembers(
  guild: Guild,
  roleName: string,
  hoursToExpire: number,
  purgeReason: string,
  purgeMessage: string
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
    const hasRole = member.roles.cache.some(role => role.name === roleName);
    const joinedTime = member.joinedTimestamp ?? 0;
    const isOverExpiration = Date.now() - joinedTime > expirationMs;

    // If hoursToExpire is 0, bypass the expiration check and immediately trigger a kick.
    // Otherwise, check if the member has exceeded the expiration time.
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

function createTaskForGuild(client: Client, guildId: string, cronSchedule: string): cron.ScheduledTask {
  return cron.schedule(
    cronSchedule,
    async () => {
      try {
        const guildConfig = await getGuildConfigOrNull(guildId);

        if (!guildConfig) {
          logger.warn('[purge-member] Guild config unavailable at tick time; skipping', { guildId });
          return;
        }

        if (!guildConfig.purgeJobsEnabled) {
          logger.warn('[purge-member] Purge jobs disabled for guild at tick time; skipping', { guildId });
          return;
        }

        const cachedGuild = client.guilds.cache.get(guildId);
        if (!cachedGuild) {
          logger.warn('[purge-member] Guild not in client cache; skipping', { guildId });
          return;
        }

        const locale = cachedGuild.preferredLocale?.substring(0, 2) || 'en';
        const cleanGuildName = cachedGuild.name.replace(/[^\w\s\-]/g, '');

        const message = i18n.__mf(
          { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
          {
            cleanGuildName,
            hoursToExpire: guildConfig.tempMemberHoursToExpire.toString(),
          }
        );

        const kicked = await purgeMembers(
          cachedGuild,
          guildConfig.tempMemberRoleName,
          guildConfig.tempMemberHoursToExpire,
          'TEMPORARY MEMBERS TIME LIMIT',
          message
        );

        logger.info(`[${cleanGuildName}] Temporary Member cleanup complete. Kicked: ${kicked.join(', ') || 'None'}`);
      } catch (error) {
        logger.error('[purge-member] Unhandled error in purge tick', { guildId, error });
      }
    },
    { timezone: 'UTC' },
  );
}

export function schedulePurgeJobs(
  client: Client,
  guildConfigs: GuildConfig[],
): Map<string, cron.ScheduledTask> {
  for (const task of activeTasks.values()) task.stop();
  activeTasks.clear();

  for (const config of guildConfigs) {
    if (!config.purgeJobsEnabled) continue;

    const { guildId, tempMemberPurgeCronSchedule } = config;

    if (!cron.validate(tempMemberPurgeCronSchedule)) {
      logger.error('[purge-member] Invalid cron schedule — job will not run', {
        guildId,
        tempMemberPurgeCronSchedule,
      });
      continue;
    }

    const task = createTaskForGuild(client, guildId, tempMemberPurgeCronSchedule);
    activeTasks.set(guildId, task);
    logger.info(`[purge-member] Scheduled temp member purge for guild ${guildId}`, {
      schedule: tempMemberPurgeCronSchedule,
    });
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
    return NO_OP_TASK;
  }

  const { tempMemberPurgeCronSchedule } = guildConfig;

  if (!cron.validate(tempMemberPurgeCronSchedule)) {
    logger.error('[purge-member] Invalid cron schedule; purge not rescheduled', {
      guildId,
      tempMemberPurgeCronSchedule,
    });
    return NO_OP_TASK;
  }

  const task = createTaskForGuild(client, guildId, tempMemberPurgeCronSchedule);
  activeTasks.set(guildId, task);
  return task;
}
