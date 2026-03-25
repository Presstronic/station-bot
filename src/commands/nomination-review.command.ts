import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { toDateString } from '../utils/date.js';
import {
  getUnprocessedNominations,
  type NominationStatusFilter,
  type NominationSortOption,
} from '../services/nominations/nominations.repository.js';
import {
  ensureCanManageReviewProcessing,
  formatNominationsAsTable,
  getCommandLocale,
  isNominationConfigurationError,
  resolveNominationOrgResultCode,
} from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';
import {
  businessResultCodes,
  createEmptyReasonCounts,
  technicalResultCodes,
} from '../services/nominations/reason-codes.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const maxDiscordMessageLength = 1800;

export const statusOptionName = i18n.__({ phrase: 'commands.nominationReview.options.status.name', locale: defaultLocale });
export const sortOptionName   = i18n.__({ phrase: 'commands.nominationReview.options.sort.name',   locale: defaultLocale });
export const limitOptionName  = i18n.__({ phrase: 'commands.nominationReview.options.limit.name',  locale: defaultLocale });
export const detailOptionName = i18n.__({ phrase: 'commands.nominationReview.options.detail.name', locale: defaultLocale });

export const NOMINATION_REVIEW_COMMAND_NAME = 'nomination-review';

export const nominationReviewCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_REVIEW_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationReview.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((o) =>
    o.setName(statusOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationReview.options.status.description', locale: defaultLocale }))
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
     .setDescription(i18n.__({ phrase: 'commands.nominationReview.options.sort.description', locale: defaultLocale }))
     .setRequired(false)
     .addChoices(
       { name: 'newest',                value: 'newest' },
       { name: 'oldest',                value: 'oldest' },
       { name: 'nomination_count_desc', value: 'nomination_count_desc' },
     )
  )
  .addIntegerOption((o) =>
    o.setName(limitOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationReview.options.limit.description', locale: defaultLocale }))
     .setRequired(false)
     .setMinValue(1)
     .setMaxValue(100)
  )
  .addBooleanOption((o) =>
    o.setName(detailOptionName)
     .setDescription(i18n.__({ phrase: 'commands.nominationReview.options.detail.description', locale: defaultLocale }))
     .setRequired(false)
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

export async function handleNominationReviewCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  // Defer immediately — permission checks below involve async Discord/DB work.
  // Placed before try so a 10062 (expired token) bubbles to the router rather than
  // being swallowed and logged at ERROR here.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {

    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    const statusFilter = interaction.options.getString(statusOptionName) as NominationStatusFilter | null;
    const sortChoice   = (interaction.options.getString(sortOptionName) ?? 'newest') as NominationSortOption;
    const limitValue   =  interaction.options.getInteger(limitOptionName) ?? 25;
    const showDetail   =  interaction.options.getBoolean(detailOptionName) ?? false;

    // Fetch one extra to detect truncation without a COUNT query
    const nominations = await getUnprocessedNominations({
      status: statusFilter ?? undefined,
      sort: sortChoice,
      limit: limitValue + 1,
    });
    const isTruncated = nominations.length > limitValue;
    const displayNominations = isTruncated ? nominations.slice(0, limitValue) : nominations;

    if (displayNominations.length === 0) {
      const phrase = statusFilter
        ? 'commands.nominationReview.responses.noneFiltered'
        : 'commands.nominationReview.responses.none';
      const content = statusFilter
        ? i18n.__mf({ phrase, locale }, {
            filterContext: i18n.__mf(
              { phrase: 'commands.nominationReview.responses.filterContext', locale },
              { status: statusFilter, sort: sortChoice, limit: String(limitValue) }
            ),
          })
        : i18n.__({ phrase, locale });
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }

    const truncatedHint = isTruncated
      ? i18n.__({ phrase: 'commands.nominationReview.responses.truncatedHint', locale })
      : '';

    const lastCheckTimes = displayNominations.map((n) => n.lastOrgCheckAt ?? null);
    const lastRefreshedAt = toDateString(getLastRefreshedAtUtc(lastCheckTimes));

    const filterContext = i18n.__mf(
      { phrase: 'commands.nominationReview.responses.filterContext', locale },
      { status: statusFilter ?? 'all', sort: sortChoice, limit: String(limitValue) }
    );

    const reasonCounts = createEmptyReasonCounts();
    for (const nomination of displayNominations) {
      const code = resolveNominationOrgResultCode(nomination);
      if (code && code in reasonCounts) {
        reasonCounts[code as keyof typeof reasonCounts] += 1;
      }
    }

    const qualifiedCount     = reasonCounts['not_in_org'];
    const disqualifiedCount  = reasonCounts['in_org'];
    const needsAttentionCount = displayNominations.filter((n) => n.lifecycleState === 'checked').length;
    const newCount           = displayNominations.filter((n) => n.lifecycleState === 'new').length;
    const businessOutcomeCount = displayNominations.filter((n) => {
      const code = resolveNominationOrgResultCode(n);
      return code && businessResultCodes.includes(code as any);
    }).length;
    const technicalOutcomeCount = displayNominations.filter((n) => {
      const code = resolveNominationOrgResultCode(n);
      return code && technicalResultCodes.includes(code as any);
    }).length;
    const neverCheckedCount  = displayNominations.filter((n) => !n.lastOrgCheckAt).length;
    const unclassifiedCount  = displayNominations.filter((n) => n.lastOrgCheckAt && !resolveNominationOrgResultCode(n)).length;

    const table = formatNominationsAsTable(displayNominations, showDetail);
    const totalCount = String(displayNominations.length) + truncatedHint;

    const summaryPhrase = showDetail
      ? 'commands.nominationReview.responses.summary'
      : 'commands.nominationReview.responses.summaryBusiness';

    const inlineContent = i18n.__mf(
      { phrase: summaryPhrase, locale },
      {
        filterContext,
        table,
        totalCount,
        newCount: String(newCount),
        qualifiedCount: String(qualifiedCount),
        disqualifiedCount: String(disqualifiedCount),
        needsAttentionCount: String(needsAttentionCount),
        businessOutcomeCount: String(businessOutcomeCount),
        technicalOutcomeCount: String(technicalOutcomeCount),
        inOrgCount: String(reasonCounts['in_org']),
        notInOrgCount: String(reasonCounts['not_in_org']),
        notFoundCount: String(reasonCounts['not_found']),
        timeoutCount: String(reasonCounts['http_timeout']),
        rateLimitedCount: String(reasonCounts['rate_limited']),
        parseFailedCount: String(reasonCounts['parse_failed']),
        httpErrorCount: String(reasonCounts['http_error']),
        unclassifiedCount: String(unclassifiedCount),
        neverCheckedCount: String(neverCheckedCount),
        lastRefreshedAt,
      }
    );

    if (inlineContent.length <= maxDiscordMessageLength) {
      await interaction.editReply({ content: inlineContent, allowedMentions: { parse: [] } });
    } else {
      const attachment = new AttachmentBuilder(Buffer.from(table, 'utf8'), {
        name: 'nominations.txt',
      });
      const attachmentPhrase = showDetail
        ? 'commands.nominationReview.responses.summaryAttachment'
        : 'commands.nominationReview.responses.summaryBusinessAttachment';
      const attachmentContent = i18n.__mf(
        { phrase: attachmentPhrase, locale },
        {
          filterContext,
          totalCount,
          newCount: String(newCount),
          qualifiedCount: String(qualifiedCount),
          disqualifiedCount: String(disqualifiedCount),
          needsAttentionCount: String(needsAttentionCount),
          businessOutcomeCount: String(businessOutcomeCount),
          technicalOutcomeCount: String(technicalOutcomeCount),
          inOrgCount: String(reasonCounts['in_org']),
          notInOrgCount: String(reasonCounts['not_in_org']),
          notFoundCount: String(reasonCounts['not_found']),
          timeoutCount: String(reasonCounts['http_timeout']),
          rateLimitedCount: String(reasonCounts['rate_limited']),
          parseFailedCount: String(reasonCounts['parse_failed']),
          httpErrorCount: String(reasonCounts['http_error']),
          unclassifiedCount: String(unclassifiedCount),
          neverCheckedCount: String(neverCheckedCount),
          lastRefreshedAt,
        }
      );
      await interaction.editReply({
        content: attachmentContent,
        files: [attachment],
        allowedMentions: { parse: [] },
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-review command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    await interaction.editReply({
      content: i18n.__({ phrase, locale }),
      allowedMentions: { parse: [] },
    });
  }
}
