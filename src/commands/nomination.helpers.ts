import {
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import type { NominationRecord } from '../services/nominations/types.ts';
import { getReviewProcessRoleIds } from '../services/nominations/access-control.repository.ts';
import { sanitizeForInlineText } from '../utils/sanitize.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const organizationMemberRoleName = process.env.ORGANIZATION_MEMBER_ROLE_NAME || 'Organization Member';
const organizationMemberRoleId = process.env.ORGANIZATION_MEMBER_ROLE_ID;
const organizationRoleCache = new Map<string, string>();

export function isNominationConfigurationError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('DATABASE_URL') || message.includes('Missing nomination schema objects');
}

export function getCommandLocale(interaction: ChatInputCommandInteraction): string {
  return interaction.locale?.substring(0, 2) ?? defaultLocale;
}

export async function getGuildMember(
  interaction: ChatInputCommandInteraction
): Promise<GuildMember | null> {
  const guild = interaction.guild;
  if (!guild) {
    return null;
  }

  return (
    guild.members.cache.get(interaction.user.id) ||
    (await guild.members.fetch(interaction.user.id).catch(() => null))
  );
}

export async function hasOrganizationMemberOrHigher(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  if (!interaction.inGuild()) {
    return false;
  }

  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const guild = interaction.guild;
  const member = await getGuildMember(interaction);
  if (!guild || !member) {
    return false;
  }

  const cachedRoleId = organizationRoleCache.get(guild.id);
  let organizationRole =
    (cachedRoleId && guild.roles.cache.get(cachedRoleId)) ||
    (organizationMemberRoleId && guild.roles.cache.get(organizationMemberRoleId)) ||
    guild.roles.cache.find((role) => role.name === organizationMemberRoleName);

  if (!organizationRole) {
    await guild.roles.fetch();
    organizationRole =
      (organizationMemberRoleId && guild.roles.cache.get(organizationMemberRoleId)) ||
      guild.roles.cache.find((role) => role.name === organizationMemberRoleName);
  }

  if (!organizationRole) {
    return false;
  }

  organizationRoleCache.set(guild.id, organizationRole.id);
  return member.roles.highest.comparePositionTo(organizationRole) >= 0;
}

export async function ensureAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const locale = getCommandLocale(interaction);

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      ephemeral: true,
    });
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.adminOnly', locale }),
      ephemeral: true,
    });
    return false;
  }

  return true;
}

export async function ensureCanManageReviewProcessing(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const locale = getCommandLocale(interaction);

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      ephemeral: true,
    });
    return false;
  }

  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      ephemeral: true,
    });
    return false;
  }

  let allowedRoleIds: string[];
  try {
    allowedRoleIds = await getReviewProcessRoleIds();
  } catch (error) {
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    await interaction.reply({
      content: i18n.__({ phrase, locale }),
      ephemeral: true,
    });
    return false;
  }
  if (allowedRoleIds.length === 0) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      ephemeral: true,
    });
    return false;
  }

  const hasAllowedRole = allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  if (!hasAllowedRole) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      ephemeral: true,
    });
    return false;
  }

  return true;
}

export function getOrganizationMemberRoleName(): string {
  return organizationMemberRoleName;
}

export function formatNominationsAsTable(records: NominationRecord[]): string {
  const headers = ['Handle', 'Count', 'Org', 'Last Nomination', 'Nominators'];
  const rows = records.map((record) => {
    const latestEvent = record.events[record.events.length - 1];
    const nominators = sanitizeForInlineText(
      [...new Set(record.events.map((e) => e.nominatorUserTag))].slice(0, 3).join(', ')
    );
    const orgLabel = record.lastOrgCheckStatus ?? 'unknown';

    return [
      sanitizeForInlineText(record.displayHandle),
      String(record.nominationCount),
      orgLabel,
      latestEvent?.createdAt ?? '-',
      nominators || '-',
    ];
  });

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => row[columnIndex].length))
  );

  const formatRow = (row: string[]) =>
    row.map((cell, index) => cell.padEnd(widths[index], ' ')).join(' | ');

  const separator = widths.map((width) => '-'.repeat(width)).join('-+-');
  const lines = [formatRow(headers), separator, ...rows.map(formatRow)];
  return lines.join('\n');
}
