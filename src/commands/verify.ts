import {
    Client,
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
  } from 'discord.js';
  import { REST } from '@discordjs/rest';
  import { Routes } from 'discord-api-types/v10';
  import { generateDrdntVerificationCode } from '../services/auth/verification-code.services';
  import { logger } from '../utils/logger';
  
  export const verifyCommands = [
    new SlashCommandBuilder()
      .setName('verify')
      .setDescription('Verify your RSI profile')
      .addStringOption((option) =>
        option
          .setName('in-game-name')
          .setDescription('Your RSI profile name')
          .setRequired(true)
      )
  ];
  
  const verificationCodes = new Map<
    string,
    { rsiProfileName: string; dreadnoughtValidationCode: string }
  >();
  
  export async function handleVerifyCommand(interaction: ChatInputCommandInteraction) {
    
      const rsiProfileName = interaction.options.getString('in-game-name', true);
  
      // Generate a unique verification code
      const dreadnoughtValidationCode = generateDrdntVerificationCode();
      // TODO: dreadnoughtValidationCode has to match the Map definition?
      verificationCodes.set(interaction.user.id, { rsiProfileName, dreadnoughtValidationCode });
  
      // Create a Verify button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('verify')
          .setLabel('Verify')
          .setStyle(ButtonStyle.Success)
      );
 
      // TODO: Add link to profile: https://robertsspaceindustries.com/account/profile
      // TODO: Add copy button
      await interaction.reply({
        content: `Hello ${interaction.user}, please add the following verification code to your RSI profile's short bio:\n\n` +
          `\`${dreadnoughtValidationCode}\`\n\n` +
          `Once you've done that, click the 'Verify' button below.`,
        components: [row],
        ephemeral: true,
      });
    }
  
  export function getUserVerificationData(userId: string) {
    return verificationCodes.get(userId);
  }
  