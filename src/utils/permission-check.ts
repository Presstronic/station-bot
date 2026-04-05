import { Guild, PermissionFlagsBits } from 'discord.js';
import { getLogger } from './logger.js';

const logger = getLogger();

type PermissionKey = keyof typeof PermissionFlagsBits;

const PERMISSION_LABELS: Partial<Record<PermissionKey, string>> = {
  ManageRoles: 'Manage Roles — required to assign the Verified role',
  ManageNicknames: 'Manage Nicknames — required to set member nicknames on verification',
  KickMembers: 'Kick Members — required by the member purge jobs',
  ManageChannels: 'Manage Channels — required by the manufacturing feature',
};

/**
 * Returns the list of permission keys the bot is missing for the given feature flags.
 */
export function checkBotPermissions(
  guild: Guild,
  flags: { verificationEnabled: boolean; purgeJobsEnabled: boolean; manufacturingEnabled: boolean },
): PermissionKey[] {
  const required: PermissionKey[] = [];

  if (flags.verificationEnabled) {
    required.push('ManageRoles', 'ManageNicknames');
  }
  if (flags.purgeJobsEnabled) {
    required.push('KickMembers');
  }
  if (flags.manufacturingEnabled) {
    required.push('ManageChannels');
  }

  if (!guild.members.me) {
    return required;
  }

  return required.filter((key) => !guild.members.me!.permissions.has(PermissionFlagsBits[key]));
}

/**
 * Sends a DM to the guild owner listing all missing permissions.
 * Failures are logged at warn level and swallowed — never throws.
 */
export async function notifyOwnerOfMissingPermissions(
  guild: Guild,
  missing: PermissionKey[],
): Promise<void> {
  if (missing.length === 0) return;

  const bulletLines = missing
    .map((key) => `• ${PERMISSION_LABELS[key] ?? key}`)
    .join('\n');

  const message =
    `⚠️ Station Bot is missing required Discord permissions in **${guild.name}**.\n\n` +
    `Missing permissions:\n${bulletLines}\n\n` +
    `Please grant these permissions to the Station Bot role in your server settings.`;

  try {
    const owner = await guild.fetchOwner();
    const dm = await owner.createDM();
    await dm.send(message);
  } catch (error) {
    logger.warn('Failed to DM guild owner about missing permissions', { guildId: guild.id, error });
  }
}
