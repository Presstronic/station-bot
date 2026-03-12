import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import {
  markAllNominationsProcessed,
  markNominationProcessedByHandle,
} from '../services/nominations/nominations.repository.ts';
import {
  ensureCanManageReviewProcessing,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
export const rsiHandleOptionName   = i18n.__({ phrase: 'commands.processNomination.options.rsiHandle.name',   locale: defaultLocale });
export const confirmAllOptionName  = i18n.__({ phrase: 'commands.processNomination.options.confirmAll.name',  locale: defaultLocale });
const logger = getLogger();

export const PROCESS_NOMINATION_COMMAND_NAME = 'process-nomination';

export const processNominationCommandBuilder = new SlashCommandBuilder()
  .setName(PROCESS_NOMINATION_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.processNomination.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(rsiHandleOptionName)
      .setDescription(
        i18n.__({
          phrase: 'commands.processNomination.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  )
  .addBooleanOption((o) =>
    o.setName(confirmAllOptionName)
     .setDescription(i18n.__({ phrase: 'commands.processNomination.options.confirmAll.description', locale: defaultLocale }))
     .setRequired(false)
  );

export async function handleProcessNominationCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    const handle = interaction.options.getString(rsiHandleOptionName)?.trim() || null;

    if (handle) {
      const updated = await markNominationProcessedByHandle(handle, interaction.user.id);
      await interaction.reply({
        content: updated
          ? i18n.__mf(
              { phrase: 'commands.processNomination.responses.singleProcessed', locale },
              { rsiHandle: handle }
            )
          : i18n.__mf(
              { phrase: 'commands.processNomination.responses.singleNotFound', locale },
              { rsiHandle: handle }
            ),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const confirmAll = interaction.options.getBoolean(confirmAllOptionName);
    if (!confirmAll) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.processNomination.responses.confirmAllRequired', locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const count = await markAllNominationsProcessed(interaction.user.id);
    await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.processNomination.responses.allProcessed', locale },
        { processedCount: String(count) }
      ),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`process-nomination command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: i18n.__({ phrase, locale }),
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase, locale }),
        ephemeral: true,
      });
    }
  }
}
