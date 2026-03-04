import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { getUnprocessedNominations } from '../services/nominations/nominations.repository.ts';
import {
  ensureCanManageReviewProcessing,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.ts';
import { refreshOrgStatusesForNominations } from '../services/nominations/org-refresh.service.ts';
import { getLogger } from '../utils/logger.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const rsiHandleKey = 'commands.refreshNominationOrgStatus.options.rsiHandle.name';

export const REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME = 'refresh-nomination-org-status';

export const refreshNominationOrgStatusCommandBuilder = new SlashCommandBuilder()
  .setName(REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.refreshNominationOrgStatus.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: rsiHandleKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.refreshNominationOrgStatus.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

export async function handleRefreshNominationOrgStatusCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  try {
    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    const requestedHandle =
      interaction.options.getString(i18n.__({ phrase: rsiHandleKey, locale: defaultLocale }))?.trim() || null;

    const nominations = await getUnprocessedNominations();
    const targets = requestedHandle
      ? nominations.filter(
          (nomination) => nomination.normalizedHandle === requestedHandle.trim().toLowerCase()
        )
      : nominations;

    if (requestedHandle && targets.length === 0) {
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.refreshNominationOrgStatus.responses.singleNotFound', locale },
          { rsiHandle: requestedHandle }
        ),
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (targets.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.refreshNominationOrgStatus.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const summary = await refreshOrgStatusesForNominations(targets);
    await interaction.editReply({
      content: i18n.__mf(
        { phrase: 'commands.refreshNominationOrgStatus.responses.summary', locale },
        {
          targetCount: String(summary.targetCount),
          refreshedCount: String(summary.refreshedCount),
          errorCount: String(summary.errorCount),
          inOrgCount: String(summary.inOrgCount),
          notInOrgCount: String(summary.notInOrgCount),
          unknownCount: String(summary.unknownCount),
          errorHandles: summary.errorHandles.length > 0 ? summary.errorHandles.join(', ') : 'none',
        }
      ),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`refresh-nomination-org-status command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    if (interaction.replied || interaction.deferred) {
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
