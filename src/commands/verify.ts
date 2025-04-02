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
import i18n from 'i18n';

const logger = getLogger();

// Helper to retrieve localized strings.
// It accepts a key, a locale (defaulting to 'en'), and optional parameters for placeholders.
function getLocalizedString(
  key: string,
  locale: string = 'en',
  params?: Record<string, string>
): string {
  return i18n.__({ phrase: key, locale }, params || {});
}

// Define the verify command with localization for description and option fields.
const verifyCommand = new SlashCommandBuilder()
  .setName('verify')
  // Command names must remain static, so we reuse the same value for localization.
  .setNameLocalization('fr', 'verify')
  .setDescription(getLocalizedString('commands.verify.description'))
  .setDescriptionLocalization('fr', getLocalizedString('commands.verify.description', 'fr'))
  .addStringOption((option) =>
    option
      .setName('in-game-name')
      .setNameLocalization('fr', 'in-game-name')
      .setDescription(getLocalizedString('commands.verify.options.inGameName.description'))
      .setDescriptionLocalization('fr', getLocalizedString('commands.verify.options.inGameName.description', 'fr'))
      .setRequired(true)
  );

const commands = [verifyCommand];

// In-memory map to store verification codes for users.
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
  // Get the user's provided in-game name.
  const rsiProfileName = interaction.options.getString('in-game-name', true);

  // Generate a unique verification code.
  const dreadnoughtValidationCode = generateDrdntVerificationCode();
  verificationCodes.set(interaction.user.id, { rsiProfileName, dreadnoughtValidationCode });

  // Create a Verify button with localized label.
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('verify')
      .setLabel(
        getLocalizedString('commands.verify.buttonLabel', interaction.locale || 'en')
      )
      .setStyle(ButtonStyle.Success)
  );

  // Prepare the reply message with placeholders for user and code.
  const replyMessage = getLocalizedString(
    'commands.verify.replyMessage',
    interaction.locale || 'en',
    {
      user: interaction.user.toString(),
      code: dreadnoughtValidationCode,
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
