import cron from 'node-cron';
import { getLogger } from '../../utils/logger.js';
import { Client, Guild } from 'discord.js';
import i18n from 'i18n';

const logger = getLogger();

export async function purgeMembers(
  guild: Guild,
  roleName: string,
  hoursToExpire: number,
  purgeReason: string,
  purgeMessage: string
): Promise<string[]> {
  const MEMBERS_KICKED: string[] = [];
  const expirationMs = hoursToExpire * 60 * 60 * 1000;

  await guild.members.fetch();

  for (const member of guild.members.cache.values()) {
    const hasRole = member.roles.cache.some((role) => role.name === roleName);
    const joinedTime = member.joinedTimestamp ?? 0;
    const isOverExpiration = Date.now() - joinedTime > expirationMs;

    if ((hasRole && isOverExpiration) || (hasRole && hoursToExpire === 0)) {
      if (!member.kickable) {
        logger.error(`Cannot kick ${member.user.tag}; insufficient permissions.`);
        continue;
      }

      try {
        await member.user.send(purgeMessage);
      } catch (error) {
        logger.warn(`Unable to DM ${member.user.tag} before kick.`);
      }

      try {
        await member.kick(purgeReason);
        logger.info(`Kicked ${member.user.tag} from ${guild.name} — ${purgeReason}`);
        MEMBERS_KICKED.push(member.user.tag);
      } catch (error) {
        logger.error(`Error kicking ${member.user.tag}:`, error);
      }
    }
  }

  return MEMBERS_KICKED;
}

export function scheduleTempMemberCleanup(client: Client) {
  const TEMP_ROLE_NAME = 'Temp Member';
  const HOURS_TO_EXPIRE = 48;

  cron.schedule('*/2 * * * *', async () => {
    logger.info('Running Temp Member Cleanup');

    for (const guild of client.guilds.cache.values()) {
      try {
        const guildLocale = guild.preferredLocale || 'en';
        const guildName = guild.name;

        const kickMessage = i18n.__(
          { phrase: 'jobs.purgeMember.tempMemberKickMessage', locale: guildLocale },
          guildName,
          '' + HOURS_TO_EXPIRE
        );

        const kickedMembers = await purgeMembers(
          guild,
          TEMP_ROLE_NAME,
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
    }
  });
}
