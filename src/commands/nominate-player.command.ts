import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { recordNomination } from '../services/nominations/nominations.repository.js';
import { enqueueNominationCheckJob } from '../services/nominations/job-queue.repository.js';
import { NominationTargetCapExceededError } from '../services/nominations/types.js';
import {
  getCommandLocale,
  getOrganizationMemberRoleName,
  hasOrganizationMemberOrHigher,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';
import { getNominationRatePolicy } from '../services/nominations/anti-abuse.policy.js';
import { checkNominationAntiAbuse } from '../services/nominations/anti-abuse.service.js';
import { checkCitizenExists } from '../services/nominations/org-check.service.js';
import { sanitizeForInlineText } from '../utils/sanitize.js';
import { formatDuration } from '../utils/date.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();

// Per-user in-flight mutex: prevents concurrent requests from the same user
// both passing anti-abuse checks before either write completes (TOCTOU).
// Effective for single-instance deployments; for multi-instance, use a DB advisory lock.
const nominationsInProgress = new Set<string>();

export const NOMINATE_PLAYER_COMMAND_NAME = 'nominate-player';

const rsiHandleNameKey = 'commands.nominatePlayer.options.rsiHandle.name';
const reasonNameKey = 'commands.nominatePlayer.options.reason.name';

export const nominatePlayerCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATE_PLAYER_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominatePlayer.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: rsiHandleNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominatePlayer.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: reasonNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominatePlayer.options.reason.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

function trimHandle(handle: string): string {
  return handle.trim();
}

export async function handleNominatePlayerCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
        ephemeral: true,
      });
      return;
    }

    // Defer immediately — async work (role lookup, DB queries) can exceed Discord's 3-second window.
    await interaction.deferReply({ ephemeral: true });

    const allowed = await hasOrganizationMemberOrHigher(interaction);
    if (!allowed) {
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominatePlayer.responses.roleRequired', locale },
          { roleName: getOrganizationMemberRoleName() }
        ),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const rsiHandle = trimHandle(
      interaction.options.getString(i18n.__({ phrase: rsiHandleNameKey, locale: defaultLocale }), true)
    );
    if (!rsiHandle) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominatePlayer.responses.invalidHandle', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const reason =
      interaction.options.getString(i18n.__({ phrase: reasonNameKey, locale: defaultLocale }))?.trim() || null;

    if (nominationsInProgress.has(interaction.user.id)) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominatePlayer.responses.submissionInProgress', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    nominationsInProgress.add(interaction.user.id);
    try {
      const policy = getNominationRatePolicy();
      const violation = await checkNominationAntiAbuse(
        interaction.user.id,
        rsiHandle.toLowerCase(),
        rsiHandle,
        policy
      );
      if (violation !== null) {
        let content: string;
        if (violation.kind === 'cooldown') {
          content = i18n.__mf(
            { phrase: 'commands.nominatePlayer.responses.cooldownActive', locale },
            { formattedWait: formatDuration(violation.secondsRemaining) }
          );
        } else if (violation.kind === 'targetDailyLimit') {
          content = i18n.__mf(
            { phrase: 'commands.nominatePlayer.responses.targetDailyLimitReached', locale },
            { rsiHandle: violation.displayHandle }
          );
        } else {
          content = i18n.__mf(
            { phrase: 'commands.nominatePlayer.responses.userDailyLimitReached', locale },
            { resetsIn: formatDuration(violation.secondsUntilReset) }
          );
        }
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
        return;
      }

      const citizenCheck = await checkCitizenExists(rsiHandle);
      if (citizenCheck.status === 'not_found') {
        await interaction.editReply({
          content: i18n.__({ phrase: 'commands.nominatePlayer.responses.citizenNotFound', locale }),
          allowedMentions: { parse: [] },
        });
        return;
      }
      if (citizenCheck.status === 'unavailable') {
        logger.warn(`RSI citizen check unavailable for handle "${sanitizeForInlineText(rsiHandle)}" — proceeding with nomination`);
      }

      // Use RSI's canonical handle casing when available; fall back to user-submitted handle.
      const displayHandle = citizenCheck.status === 'found' ? citizenCheck.canonicalHandle : rsiHandle;
      const updated = await recordNomination(displayHandle, interaction.user.id, interaction.user.tag, reason, policy.targetMaxPerDay);
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominatePlayer.responses.created', locale },
          { rsiHandle: updated.displayHandle }
        ),
        allowedMentions: { parse: [] },
      });

      // Fire-and-forget: enqueue a single-scope org-check job immediately so the
      // worker picks up the new nomination without requiring a manual /nomination-refresh.
      // Failure is non-fatal — the admin can always trigger a refresh manually.
      const normalizedHandle = rsiHandle.toLowerCase();
      void enqueueNominationCheckJob(interaction.user.id, 'single', [normalizedHandle], normalizedHandle).catch(
        (err) => {
          if (err instanceof Error) {
            logger.warn(`Auto-enqueue org-check failed for "${sanitizeForInlineText(rsiHandle)}"`, { err });
          } else {
            logger.warn(
              `Auto-enqueue org-check failed for "${sanitizeForInlineText(rsiHandle)}": ${String(err)}`
            );
          }
        }
      );
    } finally {
      nominationsInProgress.delete(interaction.user.id);
    }
  } catch (error) {
    if (error instanceof NominationTargetCapExceededError) {
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominatePlayer.responses.targetDailyLimitReached', locale },
          { rsiHandle: error.displayHandle }
        ),
        allowedMentions: { parse: [] },
      });
      return;
    }
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nominate-player command failed: ${errorMessage}`);
    const isConfigurationError = isNominationConfigurationError(error);
    const isHandleValidationError = errorMessage.includes('RSI handle is required for nomination');
    const responsePhrase = isConfigurationError
      ? 'commands.nominationCommon.responses.configurationError'
      : isHandleValidationError
        ? 'commands.nominatePlayer.responses.invalidHandle'
      : 'commands.nominationCommon.responses.unexpectedError';

    if (interaction.replied || interaction.deferred) {
      await interaction.editReply({
        content: i18n.__({ phrase: responsePhrase, locale }),
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase: responsePhrase, locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }
  }
}
