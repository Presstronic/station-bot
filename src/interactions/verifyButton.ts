// src/interactions/verifyButton.ts

import {
    ButtonInteraction,
    ChatInputCommandInteraction,
    Interaction,
    Client,
  } from 'discord.js';
import { handleCitizenCommand, getUserVerificationData } from '../commands/citizen';
import { logger } from '../utils/logger';
import { verifyRSIProfile } from '../services/rsi.services';
import { assignVerifiedRole } from '../utils/role';
  
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
  
      // TODO: As part of the steps here, look at changing their discord name to match their username in SC (How do we handle alts?)
      const rsiProfile = userData.rsiProfileName;
      const rsiProfileExists = await verifyRSIProfile(rsiProfile);

      if(rsiProfileExists) {
        const success = await assignVerifiedRole(interaction, interaction.user.id)
  
        if (success) {
          await interaction.reply({
            content: `✅ Your have been verfied with citizen name **${rsiProfile}**. Enjoy your citizenship!`,
            ephemeral: true,
          });
        } else {
          await interaction.reply({
            content: `❌ Could not approve your citizenship within this server. Please try again, or contact a moderator.`,
            ephemeral: true,
          });
        }
      } else {
        await interaction.reply({
          content: `❌ An in-game citizen with the name: **${rsiProfile}** does not exist. Please ensure you've entered the correct in-game citizen name.`,
          ephemeral: true,
        });
      }      
  
      // // Inform the user about the manual verification step
      // await interaction.reply({
      //   content:
      //     `Thank you! Please notify a moderator to verify your profile.\n\n` +
      //     `**Profile Name:** \`${userData.profileName}\`\n` +
      //     `**Verification Code:** \`${userData.code}\``,
      //   ephemeral: true,
      // });
  
      // // Optionally, notify moderators
      // const guild = interaction.guild;
  
      // if (guild) {
      //   const moderatorRole = guild.roles.cache.find(
      //     (role) => role.name === 'Moderator'
      //   );
  
      //   if (moderatorRole) {
      //     const systemChannel = guild.systemChannel;
  
      //     if (systemChannel) {
      //       await systemChannel.send(
      //         `${moderatorRole}, user ${interaction.user} has requested verification.`
      //       );
      //     }
      //   }
      // }
    }
  }
  