import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { getUnprocessedNominations, updateOrgCheckStatus } from '../services/nominations/nominations.repository.ts';
import { checkHasAnyOrgMembership } from '../services/nominations/org-check.service.ts';
import type { OrgCheckStatus } from '../services/nominations/types.ts';
import { ensureCanManageReviewProcessing, formatNominationsAsTable, getCommandLocale } from './nomination.helpers.ts';
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
      let failed = false;
      try {
        status = await checkHasAnyOrgMembership(nomination.displayHandle);
      } catch (error) {
        failed = true;
        logger.error(
          `Org check failed for handle ${nomination.displayHandle}: ${String(error)}`
        );
      }
      await updateOrgCheckStatus(nomination.normalizedHandle, status);
      nomination.lastOrgCheckStatus = status;
      return { handle: nomination.displayHandle, status, failed };
    });

    const passedCount = results.filter((result) => !result.failed).length;
    const failedHandles = results.filter((result) => result.failed).map((result) => result.handle);

    const table = formatNominationsAsTable(nominations);
    const summary = i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.summary', locale },
      {
        table: `\`\`\`\n${table}\n\`\`\``,
        checkedCount: String(results.length),
        passedCount: String(passedCount),
        failedCount: String(failedHandles.length),
        failedHandles: failedHandles.length > 0 ? failedHandles.join(', ') : 'none',
      }
    );

    if (summary.length <= maxDiscordMessageLength) {
      await interaction.editReply({ content: summary });
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
          passedCount: String(passedCount),
          failedCount: String(failedHandles.length),
          failedHandles: failedHandles.length > 0 ? failedHandles.join(', ') : 'none',
        }
      ),
      files: [attachment],
    });
  } catch (error) {
    logger.error(`review-nominations command failed: ${String(error)}`);
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
        ephemeral: true,
      });
    }
  }
}
