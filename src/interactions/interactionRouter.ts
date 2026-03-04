import { Client, Interaction } from 'discord.js';
import {
  handleVerifyCommand,
  handleHealthcheckCommand,
  VERIFY_COMMAND_NAME,
  HEALTHCHECK_COMMAND_NAME,
} from '../commands/verify.ts';
import {
  handleNominatePlayerCommand,
  NOMINATE_PLAYER_COMMAND_NAME,
} from '../commands/nominate-player.command.ts';
import {
  handleReviewNominationsCommand,
  REVIEW_NOMINATIONS_COMMAND_NAME,
} from '../commands/review-nominations.command.ts';
import {
  handleProcessNominationCommand,
  PROCESS_NOMINATION_COMMAND_NAME,
} from '../commands/process-nomination.command.ts';
import {
  handleNominationAccessCommand,
  NOMINATION_ACCESS_COMMAND_NAME,
} from '../commands/nomination-access.command.ts';
import i18n from '../utils/i18n-config.ts';
import { isReadOnlyMode } from '../config/runtime-flags.ts';
import { handleVerifyButtonInteraction } from './verifyButton.ts';
import { runWithCorrelationId } from '../utils/request-context.ts';
import { getLogger } from '../utils/logger.ts';

const defaultLocale = 'en';
const logger = getLogger();

export async function handleInteraction(interaction: Interaction, _client: Client) {
  const correlationId = interaction.id;
  return runWithCorrelationId(correlationId, async () => {
    try {
      const readOnlyMode = isReadOnlyMode();
      const isHealthcheckCommand =
        interaction.isChatInputCommand() && interaction.commandName === HEALTHCHECK_COMMAND_NAME;

      if (readOnlyMode && !isHealthcheckCommand && (interaction.isChatInputCommand() || interaction.isButton())) {
        const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
        const maintenanceMessage = i18n.__({
          phrase: 'interactions.readOnly.maintenance',
          locale,
        });

        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: maintenanceMessage, ephemeral: true });
        } else {
          await interaction.reply({ content: maintenanceMessage, ephemeral: true });
        }
        return;
      }

      if (interaction.isChatInputCommand()) {
        if (interaction.commandName === VERIFY_COMMAND_NAME) {
          await handleVerifyCommand(interaction);
        } else if (interaction.commandName === HEALTHCHECK_COMMAND_NAME) {
          await handleHealthcheckCommand(interaction);
        } else if (interaction.commandName === NOMINATE_PLAYER_COMMAND_NAME) {
          await handleNominatePlayerCommand(interaction);
        } else if (interaction.commandName === REVIEW_NOMINATIONS_COMMAND_NAME) {
          await handleReviewNominationsCommand(interaction);
        } else if (interaction.commandName === PROCESS_NOMINATION_COMMAND_NAME) {
          await handleProcessNominationCommand(interaction);
        } else if (interaction.commandName === NOMINATION_ACCESS_COMMAND_NAME) {
          await handleNominationAccessCommand(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        await handleVerifyButtonInteraction(interaction);
      }
    } catch (error) {
      logger.error(`Error while handling interaction in router: ${String(error)}`);
      throw error;
    }
  });
}
