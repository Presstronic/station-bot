import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { recordNomination } from '../services/nominations/nominations.repository.ts';
import {
  getCommandLocale,
  getOrganizationMemberRoleName,
  hasOrganizationMemberOrHigher,
  isNominationConfigurationError,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';
import { getNominationRatePolicy } from '../services/nominations/anti-abuse.policy.ts';
import { checkNominationAntiAbuse } from '../services/nominations/anti-abuse.service.ts';

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
            { secondsRemaining: String(violation.secondsRemaining) }
          );
        } else if (violation.kind === 'targetDailyLimit') {
          content = i18n.__mf(
            { phrase: 'commands.nominatePlayer.responses.targetDailyLimitReached', locale },
            { rsiHandle: violation.displayHandle }
          );
        } else {
          content = i18n.__({ phrase: 'commands.nominatePlayer.responses.userDailyLimitReached', locale });
        }
        await interaction.editReply({ content, allowedMentions: { parse: [] } });
        return;
      }

      const updated = await recordNomination(rsiHandle, interaction.user.id, interaction.user.tag, reason);
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.nominatePlayer.responses.created', locale },
          {
            rsiHandle: updated.displayHandle,
            nominationCount: String(updated.nominationCount),
          }
        ),
        allowedMentions: { parse: [] },
      });
    } finally {
      nominationsInProgress.delete(interaction.user.id);
    }
  } catch (error) {
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
