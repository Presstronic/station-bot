import { Client, Interaction } from 'discord.js';
import {
  handleVerifyCommand,
  handleHealthcheckCommand,
  VERIFY_COMMAND_NAME,
  HEALTHCHECK_COMMAND_NAME,
} from '../commands/verify.js';
import {
  handleNominatePlayerCommand,
  NOMINATE_PLAYER_COMMAND_NAME,
} from '../commands/nominate-player.command.js';
import {
  handleReviewNominationsCommand,
  REVIEW_NOMINATIONS_COMMAND_NAME,
} from '../commands/review-nominations.command.js';
import {
  handleRefreshNominationOrgStatusCommand,
  REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME,
} from '../commands/refresh-nomination-org-status.command.js';
import {
  handleNominationCheckStatusCommand,
  NOMINATION_CHECK_STATUS_COMMAND_NAME,
} from '../commands/nomination-check-status.command.js';
import {
  handleProcessNominationCommand,
  PROCESS_NOMINATION_COMMAND_NAME,
} from '../commands/process-nomination.command.js';
import {
  handleNominationAccessCommand,
  NOMINATION_ACCESS_COMMAND_NAME,
} from '../commands/nomination-access.command.js';
import {
  handleNominationAuditCommand,
  NOMINATION_AUDIT_COMMAND_NAME,
} from '../commands/nomination-audit.command.js';
import i18n from '../utils/i18n-config.js';
import { isReadOnlyMode } from '../config/runtime-flags.js';
import { handleVerifyButtonInteraction } from './verifyButton.js';
import { runWithCorrelationId } from '../utils/request-context.js';
import { getLogger } from '../utils/logger.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
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
        } else if (interaction.commandName === REFRESH_NOMINATION_ORG_STATUS_COMMAND_NAME) {
          await handleRefreshNominationOrgStatusCommand(interaction);
        } else if (interaction.commandName === NOMINATION_CHECK_STATUS_COMMAND_NAME) {
          await handleNominationCheckStatusCommand(interaction);
        } else if (interaction.commandName === PROCESS_NOMINATION_COMMAND_NAME) {
          await handleProcessNominationCommand(interaction);
        } else if (interaction.commandName === NOMINATION_ACCESS_COMMAND_NAME) {
          await handleNominationAccessCommand(interaction);
        } else if (interaction.commandName === NOMINATION_AUDIT_COMMAND_NAME) {
          await handleNominationAuditCommand(interaction);
        }
        return;
      }

      if (interaction.isButton()) {
        await handleVerifyButtonInteraction(interaction);
      }
    } catch (error) {
      if (error instanceof Error) {
        const stackText = error.stack ? `\n${error.stack}` : '';
        logger.error(`Error while handling interaction in router: ${error.message}${stackText}`);
      } else {
        logger.error(`Error while handling interaction in router: ${String(error)}`);
      }
      throw error;
    }
  });
}
