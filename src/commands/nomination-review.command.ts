import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
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
  try {
    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

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

    const truncationSuffix = isTruncated
      ? i18n.__({ phrase: 'commands.nominationReview.responses.truncatedHint', locale })
      : '';
    const filterContext = i18n.__mf(
      { phrase: 'commands.nominationReview.responses.filterContext', locale },
      { status: statusFilter ?? 'all', sort: sortChoice, limit: String(limitValue) }
    ) + truncationSuffix;

    if (displayNominations.length === 0) {
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominationReview.responses.noneFiltered', locale },
          { filterContext }
        ),
      });
      return;
    }

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
    const rawLastRefreshedAt = getLastRefreshedAtUtc(displayNominations.map((nomination) => nomination.lastOrgCheckAt));
    const lastRefreshedAt = rawLastRefreshedAt === 'never' ? 'never' : toDateString(rawLastRefreshedAt);
    const newCount = displayNominations.filter((n) => n.lifecycleState === 'new').length;
    const checkedCount = displayNominations.filter((n) => n.lifecycleState === 'checked').length;
    const qualifiedCount = displayNominations.filter((n) => n.lifecycleState === 'qualified').length;
    const disqualifiedCount = displayNominations.filter((n) => n.lifecycleState === 'disqualified_in_org').length;
    const needsAttentionCount = checkedCount;

    const table = formatNominationsAsTable(displayNominations, showDetail);
    const commonCounts = {
      totalCount: String(displayNominations.length),
      newCount: String(newCount),
      qualifiedCount: String(qualifiedCount),
      disqualifiedCount: String(disqualifiedCount),
      needsAttentionCount: String(needsAttentionCount),
      lastRefreshedAt,
    };

    const summaryPhrase = showDetail
      ? 'commands.nominationReview.responses.summary'
      : 'commands.nominationReview.responses.summaryBusiness';
    const attachmentPhrase = showDetail
      ? 'commands.nominationReview.responses.summaryAttachment'
      : 'commands.nominationReview.responses.summaryBusinessAttachment';

    const detailCounts = showDetail ? {
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
    } : {};

    const summary = i18n.__mf(
      { phrase: summaryPhrase, locale },
      { filterContext, table: `\`\`\`\n${table}\n\`\`\``, ...commonCounts, ...detailCounts }
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
        { phrase: attachmentPhrase, locale },
        { filterContext, ...commonCounts, ...detailCounts }
      ),
      allowedMentions: { parse: [] },
      files: [attachment],
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-review command failed: ${errorMessage}`);
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
