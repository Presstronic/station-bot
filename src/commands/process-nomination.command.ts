import {
  ChatInputCommandInteraction,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import {
  markAllNominationsProcessed,
  markNominationProcessedByHandle,
} from '../services/nominations/nominations.repository.js';
import {
  ensureCanManageReviewProcessing,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import { recordAuditEvent } from '../services/nominations/audit.repository.js';
import { getLogger } from '../utils/logger.js';

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
      let updated = false;
      try {
        updated = await markNominationProcessedByHandle(handle, interaction.user.id);
        recordAuditEvent({
          eventType: 'nomination_processed_single',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetHandle: handle,
          payloadJson: { found: updated },
          result: 'success',
        }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
      } catch (err) {
        recordAuditEvent({
          eventType: 'nomination_processed_single',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetHandle: handle,
          result: 'failure',
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
        throw err;
      }
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

    let count = 0;
    try {
      count = await markAllNominationsProcessed(interaction.user.id);
      recordAuditEvent({
        eventType: 'nomination_processed_bulk',
        actorUserId: interaction.user.id,
        actorUserTag: interaction.user.tag,
        payloadJson: { processedCount: count },
        result: 'success',
      }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
    } catch (err) {
      recordAuditEvent({
        eventType: 'nomination_processed_bulk',
        actorUserId: interaction.user.id,
        actorUserTag: interaction.user.tag,
        result: 'failure',
        errorMessage: err instanceof Error ? err.message : String(err),
      }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
      throw err;
    }
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
