import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import {
  getUnprocessedNominationByHandle,
  getUnprocessedNominations,
} from '../services/nominations/nominations.repository.ts';
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
const maxDiscordMessageLength = 1800;

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

    const rawRequestedHandle = interaction.options.getString(
      i18n.__({ phrase: rsiHandleKey, locale: defaultLocale })
    );
    if (rawRequestedHandle !== null && rawRequestedHandle.trim().length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.refreshNominationOrgStatus.responses.invalidHandle', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const requestedHandle = rawRequestedHandle?.trim() ?? null;

    let targets: Awaited<ReturnType<typeof getUnprocessedNominations>> = [];
    if (requestedHandle) {
      const nomination = await getUnprocessedNominationByHandle(requestedHandle);
      targets = nomination ? [nomination] : [];
    } else {
      targets = await getUnprocessedNominations();
    }

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
    const baseSummaryFields = {
      targetCount: String(summary.targetCount),
      refreshedCount: String(summary.refreshedCount),
      errorCount: String(summary.errorCount),
      inOrgCount: String(summary.inOrgCount),
      notInOrgCount: String(summary.notInOrgCount),
      unknownCount: String(summary.unknownCount),
    };
    const buildSummaryContent = (errorHandles: string) =>
      i18n.__mf(
        { phrase: 'commands.refreshNominationOrgStatus.responses.summary', locale },
        {
          ...baseSummaryFields,
          errorHandles,
        }
      );
    const errorHandles = (() => {
      if (summary.errorHandles.length === 0) {
        return 'none';
      }

      for (let shownCount = summary.errorHandles.length; shownCount >= 1; shownCount -= 1) {
        const hiddenCount = summary.errorHandles.length - shownCount;
        const shownHandles = summary.errorHandles.slice(0, shownCount).join(', ');
        const candidate = hiddenCount > 0 ? `${shownHandles} (+${hiddenCount} more)` : shownHandles;
        if (buildSummaryContent(candidate).length <= maxDiscordMessageLength) {
          return candidate;
        }
      }

      return 'too many to display';
    })();

    const summaryContent = buildSummaryContent(errorHandles);
    await interaction.editReply({
      content:
        summaryContent.length <= maxDiscordMessageLength
          ? summaryContent
          : `${summaryContent.slice(0, maxDiscordMessageLength - 3)}...`,
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
