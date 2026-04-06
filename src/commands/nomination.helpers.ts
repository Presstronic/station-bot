import {
  ButtonInteraction,
  ChatInputCommandInteraction,
  GuildMember,
  PermissionFlagsBits,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { toDateString } from '../utils/date.js';
import type {
  NominationRecord,
  OrgCheckResultCode,
  OrgCheckStatus,
} from '../services/nominations/types.js';
import { getReviewProcessRoleIds } from '../services/nominations/access-control.repository.js';
import { sanitizeForInlineText } from '../utils/sanitize.js';
import { technicalResultCodes } from '../services/nominations/reason-codes.js';

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
  interaction: ChatInputCommandInteraction | ButtonInteraction
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
  interaction: ChatInputCommandInteraction | ButtonInteraction
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

/**
 * Checks that the interaction is in a guild and the member is an admin.
 * Must be called after interaction.deferReply() — uses editReply for failures.
 */
export async function ensureAdmin(interaction: ChatInputCommandInteraction): Promise<boolean> {
  const locale = getCommandLocale(interaction);

  if (!interaction.inGuild()) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }

  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.adminOnly', locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }

  return true;
}

/**
 * Checks that the interaction is in a guild and the member has review/process access
 * (admin or an explicitly configured role).
 * Must be called after interaction.deferReply() — uses editReply for failures.
 */
export async function ensureCanManageReviewProcessing(
  interaction: ChatInputCommandInteraction
): Promise<boolean> {
  const locale = getCommandLocale(interaction);

  if (!interaction.inGuild()) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }

  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    return true;
  }

  const member = await getGuildMember(interaction);
  if (!member) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      allowedMentions: { parse: [] },
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
    await interaction.editReply({
      content: i18n.__({ phrase, locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }
  if (allowedRoleIds.length === 0) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }

  const hasAllowedRole = allowedRoleIds.some((roleId) => member.roles.cache.has(roleId));
  if (!hasAllowedRole) {
    await interaction.editReply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.permissionsMissing', locale }),
      allowedMentions: { parse: [] },
    });
    return false;
  }

  return true;
}

export function getOrganizationMemberRoleName(): string {
  return organizationMemberRoleName;
}

export function resolveNominationOrgResultCode(nomination: {
  lastOrgCheckResultCode: OrgCheckResultCode | null;
  lastOrgCheckStatus: OrgCheckStatus | null;
}): OrgCheckResultCode | null {
  if (nomination.lastOrgCheckResultCode) {
    return nomination.lastOrgCheckResultCode;
  }
  if (nomination.lastOrgCheckStatus === 'in_org') {
    return 'in_org';
  }
  if (nomination.lastOrgCheckStatus === 'not_in_org') {
    return 'not_in_org';
  }
  return null;
}

export function formatNominationsAsTable(records: NominationRecord[], detail = true): string {
  const headers = ['Handle', 'Count', 'State', 'Org', 'Last Nomination', 'Nominators', 'Reason'];
  const rows = records.map((record) => {
    const latestEvent = record.events[record.events.length - 1];
    const nominators = sanitizeForInlineText(
      [...new Set(record.events.map((e) => e.nominatorUserTag))].slice(0, 3).join(', ')
    );
    const rawCode = resolveNominationOrgResultCode(record);
    const orgLabel = !detail && rawCode && technicalResultCodes.includes(rawCode)
      ? 'needs_attention'
      : (rawCode ?? 'unknown');
    const rawReason = sanitizeForInlineText(latestEvent?.reason ?? '');
    const reason = rawReason.length > 120 ? `${rawReason.slice(0, 117)}...` : rawReason || '—';

    return [
      sanitizeForInlineText(record.displayHandle),
      String(record.nominationCount),
      record.lifecycleState,
      orgLabel,
      latestEvent ? toDateString(latestEvent.createdAt) : '-',
      nominators || '-',
      reason,
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
