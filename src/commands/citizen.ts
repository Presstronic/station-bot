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
  
  const commands = [
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
  
  export async function registerCommands(client: Client) {
    // TODO: Prob not here, but somewhere I need to have the bot create the station-bot-verified role (or allow for a custom role override)
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
  