// src/commands/citizen.ts

import {
    Client,
    SlashCommandBuilder,
    CommandInteraction,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
  } from 'discord.js';
  import { REST } from '@discordjs/rest';
  import { Routes } from 'discord-api-types/v10';
  import { generateVerificationCode } from '../utils/generateCode';
  import { logger } from '../utils/logger';
  
  const commands = [
    new SlashCommandBuilder()
      .setName('citizen')
      .setDescription('Verify your RSI profile')
      .addSubcommand((subcommand) =>
        subcommand
          .setName('add')
          .setDescription('Start the verification process')
          .addStringOption((option) =>
            option
              .setName('profile_name')
              .setDescription('Your RSI profile name')
              .setRequired(true)
          )
      ),
  ];
  
  const verificationCodes = new Map<
    string,
    { code: string; profileName: string }
  >();
  
  export async function registerCommands(client: Client) {
    const CLIENT_ID = process.env.CLIENT_ID;
    const GUILD_ID = process.env.GUILD_ID;
    const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  
    if (!CLIENT_ID || !GUILD_ID || !DISCORD_BOT_TOKEN) {
      logger.error('Missing CLIENT_ID, GUILD_ID, or DISCORD_BOT_TOKEN in .env');
      return;
    }
  
    const rest = new REST({ version: '10' }).setToken(DISCORD_BOT_TOKEN);
  
    try {
      logger.info('Started refreshing application (/) commands.');
  
      await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), {
        body: commands.map((command) => command.toJSON()),
      });
  
      logger.info('Successfully reloaded application (/) commands.');
    } catch (error) {
      logger.error('Error registering commands:', error);
    }
  }
  
  export async function handleCitizenCommand(interaction: CommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
  
    if (subcommand === 'add') {
      const profileName = interaction.options.getString('profile_name', true);
  
      // Generate a unique verification code
      const code = generateVerificationCode();
      verificationCodes.set(interaction.user.id, { code, profileName });
  
      // Create a Verify button
      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId('verify')
          .setLabel('Verify')
          .setStyle(ButtonStyle.Success)
      );
  
      await interaction.reply({
        content: `Hello ${interaction.user}, please add the following verification code to your RSI profile's short bio:\n\n` +
          `\`${code}\`\n\n` +
          `Once you've done that, click the 'Verify' button below.`,
        components: [row],
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: 'Invalid subcommand.',
        ephemeral: true,
      });
    }
  }
  
  export function getUserVerificationData(userId: string) {
    return verificationCodes.get(userId);
  }
  