// src/interactions/verifyButton.ts

import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    Client,
  } from 'discord.js';
import { handleCitizenCommand } from '../commands/citizen';
import { logger } from '../utils/logger';
import { assignVerifiedRole } from '../utils/role';
import { verifyRSIProfile } from '../services/rsi.services';
 

export async function handleInteraction(
  interaction: Interaction,
  client: Client
) {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'citizen') {
      await handleCitizenCommand(interaction);
    }
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction as ButtonInteraction, client);
  }
}

async function handleButtonInteraction(
  interaction: ButtonInteraction,
  client: Client
) {
  if (interaction.customId === 'verify') {

    const rsiProfileVerified = await verifyRSIProfile(interaction.user.id);

    if (rsiProfileVerified) {
      const success = await assignVerifiedRole(interaction, interaction.user.id);

      await interaction.reply({
        content: `✅ You have been verified. Enjoy your citizenship!`,
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: `❌ Could not approve your citizenship within this server. Please try again, or contact a moderator.`,
        ephemeral: true,
      });
    }    
  }
}
  