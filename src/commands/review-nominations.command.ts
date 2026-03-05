import {
  AttachmentBuilder,
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { getUnprocessedNominations } from '../services/nominations/nominations.repository.ts';
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

export const REVIEW_NOMINATIONS_COMMAND_NAME = 'review-nominations';

export const reviewNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(REVIEW_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.reviewNominations.description', locale: defaultLocale }))
  .setDMPermission(false);

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

    const nominations = await getUnprocessedNominations();
    if (nominations.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.reviewNominations.responses.none', locale }),
      });
      return;
    }

    const inOrgCount = nominations.filter((nomination) => nomination.lastOrgCheckStatus === 'in_org').length;
    const notInOrgCount = nominations.filter((nomination) => nomination.lastOrgCheckStatus === 'not_in_org').length;
    const unknownCount = nominations.filter(
      (nomination) => nomination.lastOrgCheckStatus !== 'in_org' && nomination.lastOrgCheckStatus !== 'not_in_org'
    ).length;
    const neverCheckedCount = nominations.filter((nomination) => !nomination.lastOrgCheckAt).length;
    const lastRefreshedAt = getLastRefreshedAtUtc(nominations.map((nomination) => nomination.lastOrgCheckAt));

    const table = formatNominationsAsTable(nominations);
    const summary = i18n.__mf(
      { phrase: 'commands.reviewNominations.responses.summary', locale },
      {
        table: `\`\`\`\n${table}\n\`\`\``,
        totalCount: String(nominations.length),
        inOrgCount: String(inOrgCount),
        notInOrgCount: String(notInOrgCount),
        unknownCount: String(unknownCount),
        neverCheckedCount: String(neverCheckedCount),
        lastRefreshedAt,
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
          totalCount: String(nominations.length),
          inOrgCount: String(inOrgCount),
          notInOrgCount: String(notInOrgCount),
          unknownCount: String(unknownCount),
          neverCheckedCount: String(neverCheckedCount),
          lastRefreshedAt,
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
