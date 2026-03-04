import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { getUnprocessedNominations, updateOrgCheckStatus } from '../services/nominations/nominations.repository.ts';
import { checkHasAnyOrgMembership } from '../services/nominations/org-check.service.ts';
import type { OrgCheckStatus } from '../services/nominations/types.ts';
import {
  ensureCanManageReviewProcessing,
  formatNominationsAsTable,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const maxDiscordMessageLength = 1800;
const orgCheckConcurrency = 5;

export const REVIEW_NOMINATIONS_COMMAND_NAME = 'review-nominations';

export const reviewNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(REVIEW_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.reviewNominations.description', locale: defaultLocale }))
  .setDMPermission(false);

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iteratee: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await iteratee(items[current], current);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function handleReviewNominationsCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const nominations = await getUnprocessedNominations();
    if (nominations.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.reviewNominations.responses.none', locale }),
      });
      return;
    }

    const results = await mapWithConcurrency(nominations, orgCheckConcurrency, async (nomination) => {
      let status: OrgCheckStatus = 'unknown';
      let checkErrored = false;
      try {
        status = await checkHasAnyOrgMembership(nomination.displayHandle);
      } catch (error) {
        checkErrored = true;
        logger.error(
          `Org check failed for handle ${nomination.displayHandle}: ${String(error)}`
        );
      }
      await updateOrgCheckStatus(nomination.normalizedHandle, status);
      nomination.lastOrgCheckStatus = status;
      return { handle: nomination.displayHandle, status, checkErrored };
    });

    const completedResults = results.filter((result) => !result.checkErrored);
    const inOrgCount = completedResults.filter((result) => result.status === 'in_org').length;
    const notInOrgCount = completedResults.filter((result) => result.status === 'not_in_org').length;
    const unknownCount = completedResults.filter((result) => result.status === 'unknown').length;
    const checkErrorHandles = results
      .filter((result) => result.checkErrored)
      .map((result) => result.handle);
    const checksCompletedCount = results.length - checkErrorHandles.length;

    const table = formatNominationsAsTable(nominations);
    const summary = i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.summary', locale },
      {
        table: `\`\`\`\n${table}\n\`\`\``,
        checkedCount: String(results.length),
        checksCompletedCount: String(checksCompletedCount),
        checkErrorsCount: String(checkErrorHandles.length),
        inOrgCount: String(inOrgCount),
        notInOrgCount: String(notInOrgCount),
        unknownCount: String(unknownCount),
        checkErrorHandles: checkErrorHandles.length > 0 ? checkErrorHandles.join(', ') : 'none',
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
          checkedCount: String(results.length),
          checksCompletedCount: String(checksCompletedCount),
          checkErrorsCount: String(checkErrorHandles.length),
          inOrgCount: String(inOrgCount),
          notInOrgCount: String(notInOrgCount),
          unknownCount: String(unknownCount),
          checkErrorHandles: checkErrorHandles.length > 0 ? checkErrorHandles.join(', ') : 'none',
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
