import { ButtonInteraction, DiscordAPIError, MessageFlags, PermissionFlagsBits, RESTJSONErrorCodes } from 'discord.js';
import { getUserVerificationData, clearUserVerificationData } from '../commands/verify.command.js';
import { getLogger } from '../utils/logger.js';
import { assignVerifiedRole, removeVerifiedRole } from '../services/role.services.js';
import { verifyRSIProfile } from '../services/rsi.services.js';
import { getGuildConfigOrNull } from '../domain/guild-config/guild-config.service.js';
import i18n from '../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

// Mirrors the transport error names recognised by interactionRouter — these are
// infrastructure failures where a fallback reply attempt would also fail.
const TRANSPORT_ERROR_NAMES = new Set([
  'ConnectTimeoutError',
  'HeadersTimeoutError',
  'BodyTimeoutError',
  'SocketError',
  'UndiciError',
  'AbortError',
]);

export async function handleVerifyButtonInteraction(interaction: ButtonInteraction) {
  if (interaction.customId !== 'verify') {
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    try {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    } catch (error) {
      // Mirror the router's log-level taxonomy so expected operational failures
      // (expired token, transport outage) don't produce a spurious high-severity
      // log in addition to the router's own warn entry.
      const isOperational =
        (error instanceof DiscordAPIError && error.code === RESTJSONErrorCodes.UnknownInteraction) ||
        (error instanceof Error && TRANSPORT_ERROR_NAMES.has(error.name));
      if (isOperational) {
        logger.warn('Failed to defer verify button reply', { userId: interaction.user.id, error });
      } else {
        logger.error('Failed to defer verify button reply', { userId: interaction.user.id, error });
      }
      throw error;
    }
  }

  async function respond(content: string): Promise<void> {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }
    if (interaction.replied) {
      await interaction.followUp({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  }

  const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
  const userData = getUserVerificationData(interaction.user.id);

  // userData is undefined if: (a) the user never ran /verify, (b) the session was
  // already cleared/consumed (for example after a verification attempt), or (c) the
  // bot restarted since the session was created (in-memory store, not persisted).
  if (!userData) {
    await respond(
      i18n.__({ phrase: 'commands.verify.responses.sessionExpired', locale })
    );
    return;
  }

  const guildId = interaction.guild?.id;
  if (!guildId) {
    await respond(i18n.__({ phrase: 'commands.verify.responses.sessionExpired', locale }));
    return;
  }
  let guildConfig;
  try {
    guildConfig = await getGuildConfigOrNull(guildId);
  } catch (error) {
    logger.error('Failed to load guild config during verify button interaction', { guildId, error });
    await respond('Verification is temporarily unavailable. Please try again later or contact a server administrator.');
    return;
  }
  if (!guildConfig) {
    logger.warn('Guild config not found during verify button interaction', { guildId });
    await respond('Verification is not configured for this server. Please contact an administrator.');
    return;
  }

  if (!guildConfig.verificationEnabled) {
    logger.warn('Verification disabled for guild during verify button interaction', { guildId });
    await respond('Verification is not currently enabled for this server. Please contact an administrator.');
    return;
  }

  try {
    const { verified: rsiProfileVerified, canonicalHandle } = await verifyRSIProfile(interaction.user.id);
    logger.debug(`RSI Profile Verified: ${rsiProfileVerified}`);

    if (rsiProfileVerified) {
      const success = await assignVerifiedRole(interaction, interaction.user.id, guildConfig.verifiedRoleName);
      logger.debug(`Role assignment success: ${success}`);

      if (success) {
        logger.debug(`Role assigned successfully to user ID: ${interaction.user.id}`);

        const successMsg = i18n.__mf(
          { phrase: 'commands.verify.responses.success', locale },
          { rsiName: canonicalHandle, username: interaction.user.username }
        );

        if (!interaction.appPermissions?.has(PermissionFlagsBits.ManageNicknames)) {
          await respond(
            `${successMsg}\n\n${i18n.__({ phrase: 'commands.verify.responses.missingPermissionNickname', locale })}`
          );
          return;
        }

        try {
          const member = await interaction.guild!.members.fetch(interaction.user.id);
          await member.setNickname(canonicalHandle);
          logger.debug(`Nickname set to "${canonicalHandle}" for user ID: ${interaction.user.id}`);
        } catch (error) {
          logger.warn('Failed to set nickname during verification', { userId: interaction.user.id, error });
          await respond(
            `${successMsg}\n\n${i18n.__({ phrase: 'commands.verify.responses.nicknameFailed', locale })}`
          );
          return;
        }

        await respond(successMsg);
      } else {
        await respond(
          i18n.__mf(
            { phrase: 'commands.verify.responses.assignFailed', locale },
            { rsiName: canonicalHandle, username: interaction.user.username }
          )
        );
      }
      return;
    }

    await removeVerifiedRole(interaction, interaction.user.id, guildConfig.verifiedRoleName);
    await respond(
      i18n.__mf(
        { phrase: 'commands.verify.responses.verificationFailed', locale },
        { rsiName: canonicalHandle, username: interaction.user.username }
      )
    );
  } finally {
    clearUserVerificationData(interaction.user.id);
  }
}
