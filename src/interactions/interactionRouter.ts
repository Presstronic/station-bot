import { Client, DiscordAPIError, Interaction, MessageFlags, RESTJSONErrorCodes } from 'discord.js';
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
  handleNominationReviewCommand,
  NOMINATION_REVIEW_COMMAND_NAME,
} from '../commands/nomination-review.command.js';
import {
  handleNominationRefreshCommand,
  NOMINATION_REFRESH_COMMAND_NAME,
} from '../commands/nomination-refresh.command.js';
import {
  handleNominationJobStatusCommand,
  NOMINATION_JOB_STATUS_COMMAND_NAME,
} from '../commands/nomination-job-status.command.js';
import {
  handleNominationProcessCommand,
  NOMINATION_PROCESS_COMMAND_NAME,
} from '../commands/nomination-process.command.js';
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
          await interaction.followUp({ content: maintenanceMessage, flags: MessageFlags.Ephemeral });
        } else {
          await interaction.reply({ content: maintenanceMessage, flags: MessageFlags.Ephemeral });
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
        } else if (interaction.commandName === NOMINATION_REVIEW_COMMAND_NAME) {
          await handleNominationReviewCommand(interaction);
        } else if (interaction.commandName === NOMINATION_REFRESH_COMMAND_NAME) {
          await handleNominationRefreshCommand(interaction);
        } else if (interaction.commandName === NOMINATION_JOB_STATUS_COMMAND_NAME) {
          await handleNominationJobStatusCommand(interaction);
        } else if (interaction.commandName === NOMINATION_PROCESS_COMMAND_NAME) {
          await handleNominationProcessCommand(interaction);
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
      // Interaction token expired — Discord will show "application did not respond".
      // Nothing we can do to reply; log at warn and exit cleanly.
      if (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownInteraction) {
        logger.warn(`[cid:${correlationId}] Interaction token expired: ${error.message}`);
        return;
      }
      // Network/connectivity error — the Discord REST API was unreachable (e.g. a
      // ConnectTimeoutError from deferReply). Attempting a fallback reply would also
      // fail and waste another timeout. Log at warn (infrastructure failure, not a
      // code bug) and return; do not rethrow to index.ts.
      if (!(error instanceof DiscordAPIError)) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.warn(`[cid:${correlationId}] Interaction failed due to connectivity error: ${msg}`);
        return;
      }
      // Unexpected Discord API error — log at error for visibility but do not rethrow;
      // the router is the top-level handler and rethrowing only causes double-logging.
      if (error instanceof Error) {
        const stackText = error.stack ? `\n${error.stack}` : '';
        logger.error(`Error while handling interaction in router: ${error.message}${stackText}`);
      } else {
        logger.error(`Error while handling interaction in router: ${String(error)}`);
      }
    }
  });
}
