import { ButtonInteraction, Client, Guild, PermissionFlagsBits } from 'discord.js';
import { getLogger } from '../utils/logger.js';
import type { GuildConfig } from '../domain/guild-config/guild-config.service.js';
import { DEFAULT_ROLE_NAMES } from '../config/roles.config.js';

const logger = getLogger();

export async function assignVerifiedRole(
  interaction: ButtonInteraction,
  userId: string,
  verifiedRoleName: string,
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

  const verifiedRole = guild.roles.cache.find((role) => role.name === verifiedRoleName);
  if (!verifiedRole) {
    logger.error(`"${verifiedRoleName}" role not found.`);
    return false;
  }

  if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    logger.error('Cannot assign role: bot is missing ManageRoles permission', { guildId: guild.id });
    return false;
  }

  try {
    await member.roles.add(verifiedRole);
    logger.debug(`Assigned "${verifiedRoleName}" role to user ${member.user.username}`);
    return true;
  } catch (error) {
    logger.error('Error assigning role', { error });
    return false;
  }
}

export async function removeVerifiedRole(
  interaction: ButtonInteraction,
  userId: string,
  verifiedRoleName: string,
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

  const verifiedRole = guild.roles.cache.find((role) => role.name === verifiedRoleName);
  if (!verifiedRole) {
    logger.error(`"${verifiedRoleName}" role not found.`);
    return false;
  }

  if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageRoles)) {
    logger.error('Cannot remove role: bot is missing ManageRoles permission', { guildId: guild.id });
    return false;
  }

  try {
    await member.roles.remove(verifiedRole);
    logger.debug(`Removed "${verifiedRoleName}" role from user ${member.user.username}`);
    return true;
  } catch (error) {
    logger.error('Error removing role', { error });
    return false;
  }
}

export async function addMissingDefaultRoles(
  guild: Guild,
  client: Client,
  guildConfig: GuildConfig | null,
): Promise<void> {
  const roleNames = guildConfig
    ? [guildConfig.verifiedRoleName, guildConfig.tempMemberRoleName, guildConfig.potentialApplicantRoleName]
    : [...DEFAULT_ROLE_NAMES];
  logger.info(`[${guild.name}] Checking required roles: ${roleNames.join(', ')}`);

  try {
    await guild.roles.fetch();

    for (const roleName of roleNames) {
      const exists = guild.roles.cache.some((role) => role.name === roleName);

      if (!exists) {
        await guild.roles.create({
          name: roleName,
          reason: `Initial setup by ${client.user?.username}`,
        });
        logger.info(`[${guild.name}] Created missing role: ${roleName}`);
      }
    }
  } catch (error) {
    logger.error(`[${guild.name}] Failed to add default roles:`, error);
    throw error;
  }
}
