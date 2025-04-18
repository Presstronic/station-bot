import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    Client,
  } from 'discord.js';
import { handleVerifyCommand, getUserVerificationData } from '../commands/verify.js';
import { getLogger } from '../utils/logger.js';
import { assignVerifiedRole, removeVerifiedRole } from '../services/role.services.js';
import { verifyRSIProfile } from '../services/rsi.services.js';
import i18n from '../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = 'en';

export async function handleInteraction(
  interaction: Interaction,
  client: Client
) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'verify') {
      await handleVerifyCommand(interaction);
    }
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction as ButtonInteraction, client);
  }
}

async function handleButtonInteraction(
  interaction: ButtonInteraction,
  client: Client
) {
  const userData = getUserVerificationData(interaction.user.id);
  const rsiInGameName = userData?.rsiProfileName.split('/').pop();

  if (interaction.customId === 'verify') {
    const rsiProfileVerified = await verifyRSIProfile(interaction.user.id);
    const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
    logger.debug(`RSI Profile Verified: ${rsiProfileVerified}`); 

    if (rsiProfileVerified) {
      const success = await assignVerifiedRole(interaction, interaction.user.id);
      logger.debug(`Role assignment success: ${success}`);
      
      if(success) {
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
    } else {
      const success = await removeVerifiedRole(interaction, interaction.user.id);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.verify.responses.verificationFailed', locale },
          { rsiName: rsiInGameName, username: interaction.user.username }
        ),
        ephemeral: true,
      });
    }    
  }
}
