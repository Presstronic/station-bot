import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import {
  getUnprocessedNominations,
  type NominationStatusFilter,
  type NominationSortOption,
} from '../services/nominations/nominations.repository.ts';
import {
  ensureCanManageReviewProcessing,
  formatNominationsAsTable,
  getCommandLocale,
  isNominationConfigurationError,
  resolveNominationOrgResultCode,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';
import {
  businessResultCodes,
  createEmptyReasonCounts,
  technicalResultCodes,
} from '../services/nominations/reason-codes.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const maxDiscordMessageLength = 1800;

export const statusOptionName = i18n.__({ phrase: 'commands.reviewNominations.options.status.name', locale: defaultLocale });
export const sortOptionName   = i18n.__({ phrase: 'commands.reviewNominations.options.sort.name',   locale: defaultLocale });
export const limitOptionName  = i18n.__({ phrase: 'commands.reviewNominations.options.limit.name',  locale: defaultLocale });

export const REVIEW_NOMINATIONS_COMMAND_NAME = 'review-nominations';

export const reviewNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(REVIEW_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.reviewNominations.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName(statusOptionName)
     .setDescription(i18n.__({ phrase: 'commands.reviewNominations.options.status.description', locale: defaultLocale }))
     .setRequired(false)
     .addChoices(
       { name: 'new',                 value: 'new' },
       { name: 'checked',             value: 'checked' },
       { name: 'qualified',           value: 'qualified' },
       { name: 'disqualified_in_org', value: 'disqualified_in_org' },
     )
  )
  .addStringOption((o) =>
    o.setName(sortOptionName)
     .setDescription(i18n.__({ phrase: 'commands.reviewNominations.options.sort.description', locale: defaultLocale }))
     .setRequired(false)
     .addChoices(
       { name: 'newest',                value: 'newest' },
       { name: 'oldest',                value: 'oldest' },
       { name: 'nomination_count_desc', value: 'nomination_count_desc' },
     )
  )
  .addIntegerOption((o) =>
    o.setName(limitOptionName)
     .setDescription(i18n.__({ phrase: 'commands.reviewNominations.options.limit.description', locale: defaultLocale }))
     .setRequired(false)
     .setMinValue(1)
     .setMaxValue(100)
  );

function getLastRefreshedAtUtc(lastCheckTimes: Array<string | null>): string {
  const validTimes = lastCheckTimes.filter((value): value is string => Boolean(value));
  if (validTimes.length === 0) {
    return 'never';
  }

  let latest = validTimes[0];
  for (let index = 1; index < validTimes.length; index += 1) {
    const current = validTimes[index];
    if (current.localeCompare(latest) > 0) {
      latest = current;
    }
  }

  return latest;
}

export async function handleReviewNominationsCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const statusFilter = interaction.options.getString(statusOptionName) as NominationStatusFilter | null;
    const sortChoice   = (interaction.options.getString(sortOptionName) ?? 'newest') as NominationSortOption;
    const limitValue   =  interaction.options.getInteger(limitOptionName) ?? 25;

    // Fetch one extra to detect truncation without a COUNT query
    const nominations = await getUnprocessedNominations({
      status: statusFilter ?? undefined,
      sort: sortChoice,
      limit: limitValue + 1,
    });
    const isTruncated = nominations.length > limitValue;
    const displayNominations = isTruncated ? nominations.slice(0, limitValue) : nominations;

    if (displayNominations.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.reviewNominations.responses.none', locale }),
      });
      return;
    }

    const truncationSuffix = isTruncated
      ? i18n.__({ phrase: 'commands.reviewNominations.responses.truncatedHint', locale })
      : '';
    const filterContext = i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.filterContext', locale },
      { status: statusFilter ?? 'all', sort: sortChoice, limit: String(limitValue) }
    ) + truncationSuffix;

    const reasonCounts = createEmptyReasonCounts();
    let unclassifiedCount = 0;
    for (const nomination of displayNominations) {
      const code = resolveNominationOrgResultCode(nomination);
      if (!code) {
        if (nomination.lastOrgCheckAt) {
          unclassifiedCount += 1;
        }
        continue;
      }
      reasonCounts[code] += 1;
    }
    const businessOutcomeCount = businessResultCodes.reduce(
      (total, code) => total + reasonCounts[code],
      0
    );
    const technicalOutcomeCount = technicalResultCodes.reduce(
      (total, code) => total + reasonCounts[code],
      0
    );
    const neverCheckedCount = displayNominations.filter((nomination) => !nomination.lastOrgCheckAt).length;
    const lastRefreshedAt = getLastRefreshedAtUtc(displayNominations.map((nomination) => nomination.lastOrgCheckAt));
    const newCount = displayNominations.filter((n) => n.lifecycleState === 'new').length;
    const checkedCount = displayNominations.filter((n) => n.lifecycleState === 'checked').length;
    const qualifiedCount = displayNominations.filter((n) => n.lifecycleState === 'qualified').length;
    const disqualifiedCount = displayNominations.filter((n) => n.lifecycleState === 'disqualified_in_org').length;

    const table = formatNominationsAsTable(displayNominations);
    const summary = i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.summary', locale },
      {
        filterContext,
        table: `\`\`\`\n${table}\n\`\`\``,
        totalCount: String(displayNominations.length),
        businessOutcomeCount: String(businessOutcomeCount),
        technicalOutcomeCount: String(technicalOutcomeCount),
        inOrgCount: String(reasonCounts.in_org),
        notInOrgCount: String(reasonCounts.not_in_org),
        notFoundCount: String(reasonCounts.not_found),
        timeoutCount: String(reasonCounts.http_timeout),
        rateLimitedCount: String(reasonCounts.rate_limited),
        parseFailedCount: String(reasonCounts.parse_failed),
        httpErrorCount: String(reasonCounts.http_error),
        unclassifiedCount: String(unclassifiedCount),
        neverCheckedCount: String(neverCheckedCount),
        lastRefreshedAt,
        newCount: String(newCount),
        checkedCount: String(checkedCount),
        qualifiedCount: String(qualifiedCount),
        disqualifiedCount: String(disqualifiedCount),
      }
    );

    if (summary.length <= maxDiscordMessageLength) {
      await interaction.editReply({ content: summary, allowedMentions: { parse: [] } });
      return;
    }

    const attachment = new AttachmentBuilder(Buffer.from(table, 'utf8'), {
      name: `nominations-${Date.now()}.txt`,
    });
    await interaction.editReply({
      content: i18n.__mf(
        { phrase: 'commands.reviewNominations.responses.summaryAttachment', locale },
        {
          filterContext,
          totalCount: String(displayNominations.length),
          businessOutcomeCount: String(businessOutcomeCount),
          technicalOutcomeCount: String(technicalOutcomeCount),
          inOrgCount: String(reasonCounts.in_org),
          notInOrgCount: String(reasonCounts.not_in_org),
          notFoundCount: String(reasonCounts.not_found),
          timeoutCount: String(reasonCounts.http_timeout),
          rateLimitedCount: String(reasonCounts.rate_limited),
          parseFailedCount: String(reasonCounts.parse_failed),
          httpErrorCount: String(reasonCounts.http_error),
          unclassifiedCount: String(unclassifiedCount),
          neverCheckedCount: String(neverCheckedCount),
          lastRefreshedAt,
          newCount: String(newCount),
          checkedCount: String(checkedCount),
          qualifiedCount: String(qualifiedCount),
          disqualifiedCount: String(disqualifiedCount),
        }
      ),
      allowedMentions: { parse: [] },
      files: [attachment],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`review-nominations command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: i18n.__({ phrase, locale }),
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase, locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }
  }
}
