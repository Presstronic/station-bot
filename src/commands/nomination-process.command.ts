import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import * as nominationsRepository from '../services/nominations/nominations.repository.js';
import type { NominationLifecycleState } from '../services/nominations/nominations.repository.js';
import { notifyNominators } from '../services/nominations/nominator-notify.service.js';
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

const CONFIRM_TIMEOUT_MS = 60_000;

function getLifecycleLabel(state: NominationLifecycleState, locale: string): string {
  if (state === 'processed') {
    throw new Error(`Unexpected lifecycle state "processed" passed to getLifecycleLabel — processed nominations should be filtered out before this point.`);
  }
  return i18n.__({ phrase: `commands.nominationProcess.lifecycleStateLabels.${state}`, locale });
}

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

async function notifyNominatorsForHandle(
  interaction: ChatInputCommandInteraction,
  normalizedHandle: string
): Promise<void> {
  try {
    const nominatorIds = await nominationsRepository.getNominatorUserIdsByHandle(normalizedHandle);
    await notifyNominators(interaction.client, nominatorIds);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to notify nominators for ${normalizedHandle}: ${errorMessage}`);
  }
}

async function notifyNominatorsForHandles(
  interaction: ChatInputCommandInteraction,
  normalizedHandles: string[]
): Promise<void> {
  try {
    const nominatorIds = await nominationsRepository.getNominatorUserIdsByHandles(normalizedHandles);
    await notifyNominators(interaction.client, nominatorIds);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to notify nominators for bulk process: ${errorMessage}`);
  }
}

export async function handleNominationProcessCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  // Defer immediately — permission checks below involve async Discord/DB work.
  // Placed before try so a 10062 (expired token) bubbles to the router rather than
  // being swallowed and logged at ERROR here.
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {

    if (!(await ensureCanManageReviewProcessing(interaction))) {
      return;
    }

    const handle = interaction.options.getString(rsiHandleOptionName)?.trim() || null;

    if (handle) {
      const nomination = await nominationsRepository.getUnprocessedNominationByHandle(handle);

      if (!nomination) {
        await interaction.editReply({
          content: i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleNotFound', locale }, { rsiHandle: handle }),
          allowedMentions: { parse: [] },
        });
        return;
      }

      const { displayHandle } = nomination;

      if (nomination.lifecycleState === 'qualified') {
        // Qualified — process immediately without confirmation dialog
        let updated = false;
        try {
          updated = await nominationsRepository.markNominationProcessedByHandle(handle, interaction.user.id);
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
        if (updated) {
          await notifyNominatorsForHandle(interaction, nomination.normalizedHandle);
        }
        await interaction.editReply({
          content: updated
            ? i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleProcessed', locale }, { rsiHandle: displayHandle })
            : i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleNotFound', locale }, { rsiHandle: displayHandle }),
          allowedMentions: { parse: [] },
        });
        return;
      }

      // Non-qualified — show warning with confirmation buttons
      const lifecycleLabel = getLifecycleLabel(nomination.lifecycleState, locale);
      const processAnywayId = `process-anyway-${interaction.id}`;
      const cancelId = `cancel-single-${interaction.id}`;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(processAnywayId)
          .setLabel(i18n.__({ phrase: 'commands.nominationProcess.buttons.processAnyway', locale }))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(cancelId)
          .setLabel(i18n.__({ phrase: 'commands.nominationProcess.buttons.cancel', locale }))
          .setStyle(ButtonStyle.Secondary),
      );

      const singleResponse = await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominationProcess.responses.singleNonQualifiedPrompt', locale },
          { displayHandle, lifecycleLabel }
        ),
        components: [row],
        allowedMentions: { parse: [] },
      });

      let singleConfirmation: Awaited<ReturnType<typeof singleResponse.awaitMessageComponent>>;
      try {
        singleConfirmation = await singleResponse.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: CONFIRM_TIMEOUT_MS,
        });
      } catch (err) {
        logger.error(`awaitMessageComponent failed for single nomination prompt: ${String(err)}`);
        const isTimeout = err instanceof Error && /reason:\s*time/i.test(err.message);
        await interaction.editReply({
          content: isTimeout
            ? i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleTimeout', locale }, { displayHandle })
            : i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (singleConfirmation.customId === cancelId) {
        await singleConfirmation.update({
          content: i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleProcessCancelled', locale }, { displayHandle }),
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }

      // Process Anyway confirmed
      await singleConfirmation.deferUpdate();
      let forcedUpdated = false;
      try {
        forcedUpdated = await nominationsRepository.markNominationProcessedByHandle(handle, interaction.user.id);
        recordAuditEvent({
          eventType: 'nomination_processed_single',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetHandle: handle,
          payloadJson: { found: forcedUpdated, forcedFromState: nomination.lifecycleState },
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
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error(`nomination-process single forced failed: ${errorMessage}`);
        const phrase = isNominationConfigurationError(err)
          ? 'commands.nominationCommon.responses.configurationError'
          : 'commands.nominationCommon.responses.unexpectedError';
        await interaction.editReply({ content: i18n.__({ phrase, locale }), components: [], allowedMentions: { parse: [] } });
        return;
      }
      if (forcedUpdated) {
        await notifyNominatorsForHandle(interaction, nomination.normalizedHandle);
      }
      await interaction.editReply({
        content: forcedUpdated
          ? i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleProcessed', locale }, { rsiHandle: displayHandle })
          : i18n.__mf({ phrase: 'commands.nominationProcess.responses.singleNotFound', locale }, { rsiHandle: displayHandle }),
        components: [],
        allowedMentions: { parse: [] },
      });
      return;
    }

    // Bulk path — get count and show confirmation dialog
    const pendingCount = await nominationsRepository.countUnprocessedNominations();
    if (pendingCount === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationProcess.responses.noneToProcess', locale }),
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

    const response = await interaction.editReply({
      content: i18n.__mf(
        { phrase: 'commands.nominationProcess.responses.confirmBulkPrompt', locale },
        { count: String(pendingCount) }
      ),
      components: [row],
      allowedMentions: { parse: [] },
    });

    let confirmation: Awaited<ReturnType<typeof response.awaitMessageComponent>>;
    try {
      confirmation = await response.awaitMessageComponent({
        componentType: ComponentType.Button,
        filter: (i) => i.user.id === interaction.user.id,
        time: CONFIRM_TIMEOUT_MS,
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
      const processedHandles = await nominationsRepository.markAllNominationsProcessedWithHandles(interaction.user.id);
      count = processedHandles.length;
      if (count > 0) {
        await notifyNominatorsForHandles(interaction, processedHandles);
      }
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
    await interaction.editReply({ content: i18n.__({ phrase, locale }), allowedMentions: { parse: [] } });
  }
}
