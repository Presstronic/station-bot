import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    Client,
  } from 'discord.js';
import { handleVerifyCommand, getUserVerificationData } from '../commands/citizen';
import { logger } from '../utils/logger';
import { assignVerifiedRole, removeVerifiedRole } from '../services/discord/role.services';
import { verifyRSIProfile } from '../services/rsi/rsi.services';
 

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
    
    if (rsiProfileVerified) {
      const success = await assignVerifiedRole(interaction, interaction.user.id);

      if(success) {
        await interaction.reply({
          content: `✅ ${rsiInGameName} has been verified with RSI for discord member ${interaction.user.username}!`,
          ephemeral: true,
        });
      } else {
        await interaction.reply({
          content: `❌ Could not assign "Verfied" role for discord member ${interaction.user.username} for RSI profile ${rsiInGameName}. Please try again.`,
          ephemeral: true,
        });
      }
    } else {
      const success = await removeVerifiedRole(interaction, interaction.user.id);
      await interaction.reply({
        content: `❌ Could not verify citizenship for discord member ${interaction.user.username} for RSI profile ${rsiInGameName}. Please try again.`,
        ephemeral: true,
      });
    }    
  }
}