import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import {
  getUnprocessedNominations,
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
export const rsiHandleOptionName = i18n.__({ phrase: 'commands.nominationProcess.options.rsiHandle.name', locale: defaultLocale });
const logger = getLogger();

const BULK_CONFIRM_TIMEOUT_MS = 60_000;

export const NOMINATION_PROCESS_COMMAND_NAME = 'nomination-process';

export const nominationProcessCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_PROCESS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationProcess.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(rsiHandleOptionName)
      .setDescription(
        i18n.__({ phrase: 'commands.nominationProcess.options.rsiHandle.description', locale: defaultLocale })
      )
      .setRequired(false)
  );

export async function handleNominationProcessCommand(interaction: ChatInputCommandInteraction) {
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
          ? i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleProcessed', locale }, { rsiHandle: handle })
          : i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleNotFound', locale }, { rsiHandle: handle }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    // Bulk path — get count and show confirmation dialog
    const pending = await getUnprocessedNominations();
    if (pending.length === 0) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationProcess.responses.noneToProcess', locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const confirmId = `confirm-bulk-${interaction.id}`;
    const cancelId  = `cancel-bulk-${interaction.id}`;

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId(confirmId)
        .setLabel(i18n.__({ phrase: 'commands.nominationProcess.buttons.confirm', locale }))
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId(cancelId)
        .setLabel(i18n.__({ phrase: 'commands.nominationProcess.buttons.cancel', locale }))
        .setStyle(ButtonStyle.Secondary),
    );

    const response = await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.nominationProcess.responses.confirmBulkPrompt', locale },
        { count: String(pending.length) }
      ),
      components: [row],
      ephemeral: true,
      allowedMentions: { parse: [] },
      fetchReply: true,
    });

    let confirmation: Awaited<ReturnType<typeof response.awaitMessageComponent>>;
    try {
      confirmation = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: BULK_CONFIRM_TIMEOUT_MS,
      });
    } catch {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationProcess.responses.bulkTimeout', locale }),
        components: [],
      });
      return;
    }

    if (confirmation.customId === cancelId) {
      await confirmation.update({
        content: i18n.__({ phrase: 'commands.nominationProcess.responses.bulkCancelled', locale }),
        components: [],
      });
      return;
    }

    // Confirmed — process all
    await confirmation.deferUpdate();
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
      const errorMessage = err instanceof Error ? err.message : String(err);
      logger.error(`nomination-process bulk failed: ${errorMessage}`);
      const phrase = isNominationConfigurationError(err)
        ? 'commands.nominationCommon.responses.configurationError'
        : 'commands.nominationCommon.responses.unexpectedError';
      await interaction.editReply({ content: i18n.__({ phrase, locale }), components: [] });
      return;
    }
    await interaction.editReply({
      content: i18n.__mf(
        { phrase: 'commands.nominationProcess.responses.allProcessed', locale },
        { processedCount: String(count) }
      ),
      components: [],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-process command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({ content: i18n.__({ phrase, locale }), ephemeral: true });
    } else {
      await interaction.reply({ content: i18n.__({ phrase, locale }), ephemeral: true });
    }
  }
}
