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
import { generateDrdntVerificationCode } from '../services/verification-code.services.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';

const logger = getLogger();
const defaultLocale = 'en';

const verifyCommandBuilder = new SlashCommandBuilder()
  .setName(i18n.__({ phrase: 'commands.verify.name', locale: defaultLocale }))
  .setDescription(i18n.__({ phrase: 'commands.verify.description', locale: defaultLocale }))
  .addStringOption((option) => {
    return option
      .setName(i18n.__({ phrase: 'commands.verify.options.inGameName.name', locale: defaultLocale }))
      .setDescription(i18n.__({ phrase: 'commands.verify.options.inGameName.description', locale: defaultLocale }))
      .setRequired(true);
  });

const commands = [verifyCommandBuilder];

const verificationCodes = new Map<
  string,
  { rsiProfileName: string; dreadnoughtValidationCode: string }
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

export async function handleVerifyCommand(interaction: ChatInputCommandInteraction) {
  const locale = interaction.guild
    ? interaction.guild.preferredLocale.substring(0, 2)
    : defaultLocale;

  const optionName = i18n.__({ phrase: 'commands.verify.options.inGameName.name', locale: defaultLocale });
  const rsiProfileName = interaction.options.getString(optionName, true);

  const dreadnoughtValidationCode = generateDrdntVerificationCode();
  verificationCodes.set(interaction.user.id, { rsiProfileName, dreadnoughtValidationCode });

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('verify')
      .setLabel(i18n.__({ phrase: 'commands.verify.buttonLabel', locale }))
      .setStyle(ButtonStyle.Success)
  );

  const verifyButtonLabel = i18n.__({ phrase: 'commands.verify.buttonLabel', locale });
  const replyMessage = i18n.__mf(
    { phrase: 'commands.verify.replyMessage', locale },
    {
      user: interaction.user.toString(),
      code: dreadnoughtValidationCode,
      verifyButtonLabel: verifyButtonLabel,
    }
  );

  await interaction.reply({
    content: replyMessage,
    components: [row],
    ephemeral: true,
  });
}

export function getUserVerificationData(userId: string) {
  return verificationCodes.get(userId);
}

