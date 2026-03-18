import { ButtonInteraction } from 'discord.js';
import { getUserVerificationData } from '../commands/verify.js';
import { getLogger } from '../utils/logger.js';
import { assignVerifiedRole, removeVerifiedRole } from '../services/role.services.js';
import { verifyRSIProfile } from '../services/rsi.services.js';
import i18n from '../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export async function handleVerifyButtonInteraction(interaction: ButtonInteraction) {
  if (interaction.customId !== 'verify') {
    return;
  }

  if (!interaction.deferred && !interaction.replied) {
    await interaction.deferReply({ ephemeral: true });
  }

  async function respond(content: string): Promise<void> {
    if (interaction.deferred && !interaction.replied) {
      await interaction.editReply({ content, allowedMentions: { parse: [] } });
      return;
    }
    if (interaction.replied) {
      await interaction.followUp({ content, ephemeral: true, allowedMentions: { parse: [] } });
      return;
    }
    await interaction.reply({ content, ephemeral: true, allowedMentions: { parse: [] } });
  }

  const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
  const userData = getUserVerificationData(interaction.user.id);

  if (!userData) {
    await respond(
      i18n.__({ phrase: 'commands.verify.responses.sessionExpired', locale })
    );
    return;
  }

  const rsiInGameName = userData.rsiProfileName?.split('/').pop() ?? 'Unknown';

  const rsiProfileVerified = await verifyRSIProfile(interaction.user.id);
  logger.debug(`RSI Profile Verified: ${rsiProfileVerified}`);

  if (rsiProfileVerified) {
    const success = await assignVerifiedRole(interaction, interaction.user.id);
    logger.debug(`Role assignment success: ${success}`);

    if (success) {
      logger.debug(`Role assigned successfully to user ID: ${interaction.user.id}`);
      await respond(
        i18n.__mf(
          { phrase: 'commands.verify.responses.success', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        )
      );
    } else {
      await respond(
        i18n.__mf(
          { phrase: 'commands.verify.responses.assignFailed', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        )
      );
    }
    return;
  }

  await removeVerifiedRole(interaction, interaction.user.id);
  await respond(
    i18n.__mf(
      { phrase: 'commands.verify.responses.verificationFailed', locale },
      { rsiName: rsiInGameName, username: interaction.user.username }
    )
  );
}
