import { ButtonInteraction } from 'discord.js';
import { getUserVerificationData } from '../commands/verify.ts';
import { getLogger } from '../utils/logger.ts';
import { assignVerifiedRole, removeVerifiedRole } from '../services/role.services.ts';
import { verifyRSIProfile } from '../services/rsi.services.ts';
import i18n from '../utils/i18n-config.ts';

const logger = getLogger();
const defaultLocale = 'en';

export async function handleVerifyButtonInteraction(interaction: ButtonInteraction) {
  const userData = getUserVerificationData(interaction.user.id);
  const rsiInGameName = userData?.rsiProfileName?.split('/').pop() ?? 'Unknown';

  if (interaction.customId !== 'verify') {
    return;
  }

  const rsiProfileVerified = await verifyRSIProfile(interaction.user.id);
  const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
  logger.debug(`RSI Profile Verified: ${rsiProfileVerified}`);

  if (rsiProfileVerified) {
    const success = await assignVerifiedRole(interaction, interaction.user.id);
    logger.debug(`Role assignment success: ${success}`);

    if (success) {
      logger.debug(`Role assigned successfully to user ID: ${interaction.user.id}`);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.verify.responses.success', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        ),
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.verify.responses.assignFailed', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        ),
        ephemeral: true,
      });
    }
    return;
  }

  await removeVerifiedRole(interaction, interaction.user.id);
  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.verify.responses.verificationFailed', locale },
      { rsiName: rsiInGameName, username: interaction.user.username }
    ),
    ephemeral: true,
  });
}
