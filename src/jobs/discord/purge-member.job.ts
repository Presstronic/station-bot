import cron from 'node-cron';
import { Client, Guild } from 'discord.js';
import { getLogger } from '../../utils/logger.ts';
import i18n from 'i18n';

const logger = getLogger();

const temporaryMemberPurgeCronSchedule = process.env.TEMPORARY_MEMBER_PURGE_CRON_SCHEDULE || '0 3 * * *';
const potentialApplicantPurgeCronSchedule = process.env.POTENTIAL_APPLICANT_PURGE_CRON_SCHEDULE || '0 4 * * *';

/**
 * Kicks members with a given role who have exceeded the time limit.
 */
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
    await guild.members.fetch(); // Load full member list
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

/**
 * Cleanup task for "Temporary Member" role.
 */
export function scheduleTemporaryMemberCleanup(client: Client) {
  const TEMPORARY_ROLE_NAME = 'Temporary Member';
  const HOURS_TO_EXPIRE = 48;

  logger.info(`SCHEDTEMPMBR: Bot is in ${client.guilds.cache.size} guild(s).`);

  cron.schedule(temporaryMemberPurgeCronSchedule, async () => {
    logger.info('[Job] Running Temporary Member Cleanup');
    logger.info(`SCHEDTEMPMBR->RUNNING: Bot is in ${client.guilds.cache.size} guild(s).`);

    for (const guild of client.guilds.cache.values()) {
      try {
        const locale = guild.preferredLocale || 'en';
        const guildName = guild.name;
        const cleanGuildName = guild.name.replace(/[^\w\s\-]/g, '');

        const message = i18n.__mf(
          { phrase: 'jobs.purgeMember.temporaryMemberKickMessage', locale },
          {
            cleanGuildName,
            hoursToExpire: HOURS_TO_EXPIRE.toString()
          }
        );

        const kicked = await purgeMembers(
          guild,
          TEMPORARY_ROLE_NAME,
          HOURS_TO_EXPIRE,
          'TEMPORARY MEMBERS TIME LIMIT',
          message
        );

        logger.info(`[${cleanGuildName}] Temporary Member cleanup complete. Kicked: ${kicked.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Temporary Member cleanup failed for guild ${guild.id}:`, error);
      }
    }
  });
}

/**
 * Cleanup task for "Potential Applicant" role.
 */
export function schedulePotentialApplicantCleanup(client: Client) {
  const ROLE_NAME = 'Potential Applicant';
  const HOURS_TO_EXPIRE = 720; // 30 days

  logger.info(`SCHEDPOTAPP: Bot is in ${client.guilds.cache.size} guild(s).`);

  cron.schedule(potentialApplicantPurgeCronSchedule, async () => {
    logger.info('[Job] Running Potential Applicant Cleanup');
    logger.info(`SCHEDPOTAPP->RUNNING: Bot is in ${client.guilds.cache.size} guild(s).`);

    for (const guild of client.guilds.cache.values()) {
      try {
        const locale = guild.preferredLocale || 'en';
        const guildName = guild.name;
        const cleanGuildName = guild.name.replace(/[^\w\s\-]/g, '');
        const message = i18n.__mf(
          { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale },
          {
            cleanGuildName,
            hoursToExpire: HOURS_TO_EXPIRE.toString()
          }
        );

        const kicked = await purgeMembers(
          guild,
          ROLE_NAME,
          HOURS_TO_EXPIRE,
          'POTENTIAL APPLICANT TIME LIMIT',
          message
        );

        logger.info(`[${cleanGuildName}] Potential Applicant cleanup complete. Kicked: ${kicked.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Potential Applicant cleanup failed for guild ${guild.id}:`, error);
      }
    }
  });
}
