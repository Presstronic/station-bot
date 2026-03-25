import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { toDateString } from '../utils/date.js';
import {
  getAuditEvents,
  type AuditEventType,
} from '../services/nominations/audit.repository.js';
import {
  ensureAdmin,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

const eventTypeOptionName = i18n.__({ phrase: 'commands.nominationAudit.options.eventType.name', locale: defaultLocale });
const sinceOptionName     = i18n.__({ phrase: 'commands.nominationAudit.options.since.name',     locale: defaultLocale });
const limitOptionName     = i18n.__({ phrase: 'commands.nominationAudit.options.limit.name',     locale: defaultLocale });

export const NOMINATION_AUDIT_COMMAND_NAME = 'nomination-audit';

export const nominationAuditCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_AUDIT_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationAudit.description', locale: defaultLocale }))
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((o) =>
    o.setName(eventTypeOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationAudit.options.eventType.description', locale: defaultLocale }))
     .setRequired(false)
     .addChoices(
       { name: 'nomination_access_role_added',       value: 'nomination_access_role_added' },
       { name: 'nomination_access_role_removed',     value: 'nomination_access_role_removed' },
       { name: 'nomination_access_roles_reset',      value: 'nomination_access_roles_reset' },
       { name: 'nomination_processed_single',        value: 'nomination_processed_single' },
       { name: 'nomination_processed_bulk',          value: 'nomination_processed_bulk' },
       { name: 'nomination_check_refresh_triggered', value: 'nomination_check_refresh_triggered' },
     )
  )
  .addStringOption((o) =>
    o.setName(sinceOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationAudit.options.since.description', locale: defaultLocale }))
     .setRequired(false)
  )
  .addIntegerOption((o) =>
    o.setName(limitOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationAudit.options.limit.description', locale: defaultLocale }))
     .setRequired(false)
     .setMinValue(1)
     .setMaxValue(100)
  );

const SHORTHAND_PATTERN = /^(\d+)(h|d)$/i;

export function parseSinceOption(raw: string): Date | null {
  const shorthand = SHORTHAND_PATTERN.exec(raw.trim());
  if (shorthand) {
    const amount = Number(shorthand[1]);
    const unit = shorthand[2].toLowerCase();
    const msPerUnit = unit === 'h' ? 3600_000 : 86_400_000;
    return new Date(Date.now() - amount * msPerUnit);
  }

  const parsed = new Date(raw.trim());
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatAuditTable(events: Awaited<ReturnType<typeof getAuditEvents>>): string {
  const lines = events.map((e) => {
    const parts = [
      toDateString(e.createdAt),
      e.eventType,
      e.result,
      e.actorUserTag,
      e.targetHandle ?? e.targetRoleId ?? '-',
    ];
    if (e.payloadJson) {
      parts.push(JSON.stringify(e.payloadJson));
    }
    if (e.errorMessage) {
      parts.push(`error: ${e.errorMessage}`);
    }
    return parts.join(' | ');
  });
  return lines.join('\n');
}

export async function handleNominationAuditCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  try {
    // Defer immediately — ensureAdmin and subsequent DB work happen after acknowledgment.
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (!(await ensureAdmin(interaction))) {
      return;
    }

    const rawEventType = interaction.options.getString(eventTypeOptionName) as AuditEventType | null;
    const rawSince     = interaction.options.getString(sinceOptionName);
    const limitValue   = interaction.options.getInteger(limitOptionName) ?? 25;

    let since: Date | undefined;
    if (rawSince !== null) {
      const parsed = parseSinceOption(rawSince);
      if (!parsed) {
        await interaction.editReply({
          content: i18n.__({ phrase: 'commands.nominationAudit.responses.invalidSince', locale }),
          allowedMentions: { parse: [] },
        });
        return;
      }
      since = parsed;
    }

    const events = await getAuditEvents({
      eventType: rawEventType ?? undefined,
      since,
      limit: limitValue + 1,
    });

    const isTruncated = events.length > limitValue;
    const displayEvents = isTruncated ? events.slice(0, limitValue) : events;

    const sinceLabel = rawSince ?? 'any';
    const typeLabel  = rawEventType ?? 'any';

    const filterContext = i18n.__mf(
      { phrase: 'commands.nominationAudit.responses.filterContext', locale },
      { eventType: typeLabel, since: sinceLabel, limit: String(limitValue) }
    );
    const truncatedHint = isTruncated
      ? i18n.__({ phrase: 'commands.nominationAudit.responses.truncatedHint', locale })
      : '';

    if (displayEvents.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationAudit.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const table = formatAuditTable(displayEvents);
    const totalCount = String(displayEvents.length) + truncatedHint;

    const inlineContent = i18n.__mf(
      { phrase: 'commands.nominationAudit.responses.summary', locale },
      { filterContext, table, totalCount }
    );

    if (inlineContent.length <= 1800) {
      await interaction.editReply({
        content: inlineContent,
        allowedMentions: { parse: [] },
      });
    } else {
      const attachment = new AttachmentBuilder(Buffer.from(table, 'utf8'), {
        name: 'audit-events.txt',
      });
      const attachmentContent = i18n.__mf(
        { phrase: 'commands.nominationAudit.responses.summaryAttachment', locale },
        { filterContext, totalCount }
      );
      await interaction.editReply({
        content: attachmentContent,
        files: [attachment],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-audit command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: i18n.__({ phrase, locale }),
        allowedMentions: { parse: [] },
      });
    }
  }
}
