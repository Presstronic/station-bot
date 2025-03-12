// src/jobs/purge-member.job.ts
import cron from 'node-cron';
import { Client, Guild } from 'discord.js';

/**
 * Kicks members who have the specified role and have been
 * in the guild beyond the expiration threshold (in hours).
 */
export async function purgeMembers(
  guild: Guild,
  roleName: string,
  hoursToExpire: number,
  purgeReason: string
): Promise<string[]> {
  const MEMBERS_KICKED: string[] = [];
  const expirationMs = hoursToExpire * 60 * 60 * 1000;

  // Make sure we have an up-to-date list of all members
  await guild.members.fetch();

  for (const member of guild.members.cache.values()) {
    const hasRole = member.roles.cache.some(
      (role) => role.name === roleName
    );

    const joinedTime = member.joinedTimestamp ?? 0;
    const isOverExpiration = Date.now() - joinedTime > expirationMs;

    if (hasRole && isOverExpiration) {
      try {
        await member.user.send(`You are being kicked for ${purgeReason} so we can keep our rostsers up to date. Never fear, you can always reapply to Dreadnought Industries at any time.`);
      } catch (error) {
        console.error('Unable to send DM before kick: ', error);
      }
      
      await member.kick(
        `${roleName} expired: over ${hoursToExpire} hours on server.`
      );
      MEMBERS_KICKED.push(member.user.tag);
    }
  }

  return MEMBERS_KICKED;
}

/**
 * Schedules a nightly cleanup job that kicks server members
 * with the Temp Member role who have been on the server for
 * more than X hours.
 */
export function scheduleTempMemberCleanup(client: Client) {
  const GUILD_ID = process.env.GUILD_ID || 'YOUR_GUILD_ID';
  const TEMP_ROLE_NAME = 'Temp Member';
  const HOURS_TO_EXPIRE = 48;

  cron.schedule('30 4 * * *', async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        console.error(`Could not find guild with ID: ${GUILD_ID}`);
        return;
      }

      const kickedMembers = await purgeMembers(
        guild,
        TEMP_ROLE_NAME,
        HOURS_TO_EXPIRE,
        "TEMPORARY MEMBERS TIME LIMIT"
      );
      console.log(`Temp Member cleanup finished. Kicked:`, kickedMembers);
    } catch (error) {
      console.error('Error in cleanup job:', error);
    }
  });
}

/**
 * Schedules a nightly cleanup job that kicks server members
 * with the Potential Applicant role who have been on the server for
 * more than 30 Days (720 hours).
 */
export function schedulePotentialApplicantCleanup(client: Client) {
  const GUILD_ID = process.env.GUILD_ID || 'YOUR_GUILD_ID';
  const ROLE_NAME = 'Potential Applicant';
  const HOURS_TO_EXPIRE = 720; // 30 days

  cron.schedule('45 4 * * *', async () => {
    try {
      const guild = client.guilds.cache.get(GUILD_ID);
      if (!guild) {
        console.error(`Could not find guild with ID: ${GUILD_ID}`);
        return;
      }

      const kickedMembers = await purgeMembers(
        guild,
        ROLE_NAME,
        HOURS_TO_EXPIRE,
        "POTENTIAL APPLICANT TIME LIMIT"
      );
      console.log(`${ROLE_NAME} cleanup finished. Kicked:`, kickedMembers);
    } catch (error) {
      console.error('Error in cleanup job:', error);
    }
  });
}
