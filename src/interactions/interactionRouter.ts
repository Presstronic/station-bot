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

// Undici transport error names that indicate Discord REST was unreachable.
// These are infrastructure failures; a fallback reply attempt would also fail.
// Note: undici's RequestAbortedError has error.name === 'AbortError' at runtime,
// so we match on 'AbortError' rather than the class name.
const TRANSPORT_ERROR_NAMES = new Set([
  'ConnectTimeoutError',
  'HeadersTimeoutError',
  'BodyTimeoutError',
  'SocketError',
  'UndiciError',
  'AbortError',
]);

const FALLBACK_ERROR_CONTENT = 'An unexpected error occurred while processing your request.';

async function attemptFallbackReply(interaction: Interaction, correlationId: string): Promise<void> {
  if (!interaction.isRepliable() || interaction.replied) return;
  if (interaction.deferred) {
    await interaction
      .editReply({ content: FALLBACK_ERROR_CONTENT, allowedMentions: { parse: [] } })
      .catch(() => logger.debug(`[cid:${correlationId}] Failed to send fallback editReply`));
  } else {
    await interaction
      .reply({ content: FALLBACK_ERROR_CONTENT, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } })
      .catch(() => logger.debug(`[cid:${correlationId}] Failed to send fallback reply`));
  }
}

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
      // Transport/connectivity error — the Discord REST API was unreachable (e.g. a
      // ConnectTimeoutError from undici when deferReply times out). A fallback reply
      // would also fail, so log at warn (infrastructure failure, not a code bug) and
      // return; do not rethrow to index.ts.
      if (error instanceof Error && TRANSPORT_ERROR_NAMES.has(error.name)) {
        logger.warn(`[cid:${correlationId}] Interaction failed due to connectivity error: ${error.message}`);
        return;
      }
      // Unexpected non-DiscordAPIError (e.g. TypeError, unhandled handler bug) — log
      // at error with stack and attempt a fallback reply so the user is not left
      // with "application did not respond". Do not rethrow to avoid double-logging.
      if (!(error instanceof DiscordAPIError)) {
        const msg = error instanceof Error ? error.message : String(error);
        const stackText = error instanceof Error && error.stack ? `\n${error.stack}` : '';
        logger.error(`[cid:${correlationId}] Unhandled error in interaction handler: ${msg}${stackText}`);
        await attemptFallbackReply(interaction, correlationId);
        return;
      }
      // Unexpected DiscordAPIError — log at error and attempt a fallback reply;
      // do not rethrow to avoid double-logging.
      const stackText = error.stack ? `\n${error.stack}` : '';
      logger.error(`[cid:${correlationId}] Error while handling interaction in router: ${error.message}${stackText}`);
      await attemptFallbackReply(interaction, correlationId);
    }
  });
}
