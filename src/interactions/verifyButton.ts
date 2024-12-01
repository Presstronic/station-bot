// src/interactions/verifyButton.ts

import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    Client,
  } from 'discord.js';
  import { handleCitizenCommand, getUserVerificationData } from '../commands/citizen';
  import { logger } from '../utils/logger';
  
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
      const userData = getUserVerificationData(interaction.user.id);
  
      if (!userData) {
        await interaction.reply({
          content: 'You have not initiated a verification process.',
          ephemeral: true,
        });
        return;
      }
  
      // Inform the user about the manual verification step
      await interaction.reply({
        content:
          `Thank you! Please notify a moderator to verify your profile.\n\n` +
          `**Profile Name:** \`${userData.profileName}\`\n` +
          `**Verification Code:** \`${userData.code}\``,
        ephemeral: true,
      });
  
      // Optionally, notify moderators
      const guild = interaction.guild;
  
      if (guild) {
        const moderatorRole = guild.roles.cache.find(
          (role) => role.name === 'Moderator'
        );
  
        if (moderatorRole) {
          const systemChannel = guild.systemChannel;
  
          if (systemChannel) {
            await systemChannel.send(
              `${moderatorRole}, user ${interaction.user} has requested verification.`
            );
          }
        }
      }
    }
  }
  