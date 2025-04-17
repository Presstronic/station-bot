import { ButtonInteraction, Client, Guild } from 'discord.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

// Load required roles from .env or fallback to defaults
const DEFAULT_ROLE_ENV = process.env.DEFAULT_ROLES || 'Temp Member,Potential Applicant';
const REQUIRED_ROLES = DEFAULT_ROLE_ENV.split(',').map((r) => r.trim());

/**
 * Assigns the "Verified" role to a user.
 */
export async function assignVerifiedRole(
  interaction: ButtonInteraction,
  userId: string
): Promise<boolean> {
  const guild = interaction.guild;
  if (!guild) {
    logger.error('Guild not found in interaction.');
    return false;
  }

  const member =
    guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
  if (!member) {
    logger.error('Discord member not found in organization.');
    return false;
  }

  const verifiedRole = guild.roles.cache.find((role) => role.name === 'Verified');
  if (!verifiedRole) {
    logger.error('"Verified" role not found.');
    return false;
  }

  try {
    await member.roles.add(verifiedRole);
    logger.debug(`Assigned "Verified" role to user ${member.user.tag}`);
    return true;
  } catch (error) {
    logger.error(`Error assigning role: ${error}`);
    return false;
  }
}

/**
 * Removes the "Verified" role from a user.
 */
export async function removeVerifiedRole(
  interaction: ButtonInteraction,
  userId: string
): Promise<boolean> {
  const guild = interaction.guild;
  if (!guild) {
    logger.error('Guild not found in interaction.');
    return false;
  }

  const member =
    guild.members.cache.get(userId) || (await guild.members.fetch(userId).catch(() => null));
  if (!member) {
    logger.error('Discord member not found in organization.');
    return false;
  }

  const verifiedRole = guild.roles.cache.find((role) => role.name === 'Verified');
  if (!verifiedRole) {
    logger.error('"Verified" role not found.');
    return false;
  }

  try {
    await member.roles.remove(verifiedRole);
    logger.debug(`Removed "Verified" role from user ${member.user.tag}`);
    return true;
  } catch (error) {
    logger.error(`Error removing role: ${error}`);
    return false;
  }
}

/**
 * Adds missing default roles on guild join or bot startup.
 */
export async function addMissingDefaultRoles(guild: Guild, client: Client): Promise<void> {
  logger.info(`[${guild.name}] Checking required roles: ${REQUIRED_ROLES.join(', ')}`);

  try {
    await guild.roles.fetch();

    for (const roleName of REQUIRED_ROLES) {
      const exists = guild.roles.cache.some((role) => role.name === roleName);

      if (!exists) {
        await guild.roles.create({
          name: roleName,
          reason: `Initial setup by ${client.user?.tag}`,
        });
        logger.info(`[${guild.name}] Created missing role: ${roleName}`);
      }
    }
  } catch (error) {
    logger.error(`[${guild.name}] Failed to add default roles:`, error);
    throw error;
  }
}
