import cron from 'node-cron';
import { Client, Guild } from 'discord.js';
<<<<<<< HEAD
import { getLogger } from '../../utils/logger.js';
=======
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
import i18n from 'i18n';

const logger = getLogger();

<<<<<<< HEAD
/**
 * Kicks members with a given role who have exceeded the time limit.
 */
=======
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
export async function purgeMembers(
  guild: Guild,
  roleName: string,
  hoursToExpire: number,
  purgeReason: string,
  purgeMessage: string
): Promise<string[]> {
  const MEMBERS_KICKED: string[] = [];
  const expirationMs = hoursToExpire * 60 * 60 * 1000;

<<<<<<< HEAD
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

    if (hasRole && (hoursToExpire === 0 || isOverExpiration)) {
      if (!member.kickable) {
        logger.warn(`Cannot kick ${member.user.tag} in ${guild.name}; insufficient permissions.`);
=======
  await guild.members.fetch();

  for (const member of guild.members.cache.values()) {
    const hasRole = member.roles.cache.some((role) => role.name === roleName);
    const joinedTime = member.joinedTimestamp ?? 0;
    const isOverExpiration = Date.now() - joinedTime > expirationMs;

    if ((hasRole && isOverExpiration) || (hasRole && hoursToExpire === 0)) {
      if (!member.kickable) {
        logger.error(`Cannot kick ${member.user.tag}; insufficient permissions.`);
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
        continue;
      }

      try {
        await member.user.send(purgeMessage);
<<<<<<< HEAD
      } catch {
        logger.warn(`Could not DM ${member.user.tag} before kicking.`);
=======
      } catch (error) {
        logger.warn(`Unable to DM ${member.user.tag} before kick.`);
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
      }

      try {
        await member.kick(purgeReason);
<<<<<<< HEAD
        logger.info(`Kicked ${member.user.tag} from ${guild.name}: ${purgeReason}`);
=======
        logger.info(`Kicked ${member.user.tag} from ${guild.name} — ${purgeReason}`);
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
        MEMBERS_KICKED.push(member.user.tag);
      } catch (error) {
        logger.error(`Error kicking ${member.user.tag}:`, error);
      }
    }
  }

  return MEMBERS_KICKED;
}

<<<<<<< HEAD
/**
 * Cleanup task for "Temp Member" role.
 */
=======
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
export function scheduleTempMemberCleanup(client: Client) {
  const TEMP_ROLE_NAME = 'Temp Member';
  const HOURS_TO_EXPIRE = 48;

  cron.schedule('*/2 * * * *', async () => {
<<<<<<< HEAD
    logger.info('[Job] Running Temp Member Cleanup');

    for (const guild of client.guilds.cache.values()) {
      try {
        const locale = guild.preferredLocale || 'en';
        const guildName = guild.name;

        const message = i18n.__(
          { phrase: 'jobs.purgeMember.tempMemberKickMessage', locale },
=======
    logger.info('Running Temp Member Cleanup');

    for (const guild of client.guilds.cache.values()) {
      try {
        const guildLocale = guild.preferredLocale || 'en';
        const guildName = guild.name;

        const kickMessage = i18n.__(
          { phrase: 'jobs.purgeMember.tempMemberKickMessage', locale: guildLocale },
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
          guildName,
          HOURS_TO_EXPIRE.toString()
        );

        const kicked = await purgeMembers(
          guild,
          TEMP_ROLE_NAME,
<<<<<<< HEAD
          0, // Change to HOURS_TO_EXPIRE to enforce actual expiration
          'TEMPORARY MEMBERS TIME LIMIT',
          message
        );

        logger.info(`[${guildName}] Temp Member cleanup complete. Kicked: ${kicked.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Temp Member cleanup failed for guild ${guild.id}:`, error);
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

  cron.schedule('*/2 * * * *', async () => {
    logger.info('[Job] Running Potential Applicant Cleanup');

    for (const guild of client.guilds.cache.values()) {
      try {
        const locale = guild.preferredLocale || 'en';
        const guildName = guild.name;

        const message = i18n.__(
          { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale },
          guildName,
          HOURS_TO_EXPIRE.toString()
        );

        const kicked = await purgeMembers(
          guild,
          ROLE_NAME,
          0, // Change to HOURS_TO_EXPIRE to enforce expiration
          'POTENTIAL APPLICANT TIME LIMIT',
          message
        );

        logger.info(`[${guildName}] Potential Applicant cleanup complete. Kicked: ${kicked.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Potential Applicant cleanup failed for guild ${guild.id}:`, error);
      }
=======
          0, // 0 = no expiration limit used here
          'TEMPORARY MEMBERS TIME LIMIT',
          kickMessage
        );

        logger.info(`[${guildName}] Temp Member cleanup finished. Kicked: ${kickedMembers.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Error during temp member cleanup for guild ${guild.id}:`, error);
      }
    }
  });
}

export function schedulePotentialApplicantCleanup(client: Client) {
  const ROLE_NAME = 'Potential Applicant';
  const HOURS_TO_EXPIRE = 720; // 30 days

  cron.schedule('*/2 * * * *', async () => {
    logger.info('Running Potential Applicant Cleanup');

    for (const guild of client.guilds.cache.values()) {
      try {
        const guildLocale = guild.preferredLocale || 'en';
        const guildName = guild.name;

        const kickMessage = i18n.__(
          { phrase: 'jobs.purgeMember.potentialApplicantKickMessage', locale: guildLocale },
          guildName,
          '' + HOURS_TO_EXPIRE
        );

        const kickedMembers = await purgeMembers(
          guild,
          ROLE_NAME,
          0, // 0 = no expiration limit used here
          'POTENTIAL APPLICANT TIME LIMIT',
          kickMessage
        );

        logger.info(`[${guildName}] Potential Applicant purge finished. Kicked: ${kickedMembers.join(', ') || 'None'}`);
      } catch (error) {
        logger.error(`Error during potential applicant cleanup for guild ${guild.id}:`, error);
      }
>>>>>>> bf5641a3e13dab6d6bccfb89a692b1db65df2300
    }
  });
}
