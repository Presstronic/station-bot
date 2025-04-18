import {
  Client,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import { discordRestClient } from '../utils/discord-rest-client.js';
import { generateDrdntVerificationCode } from '../services/verification-code.services.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';
import { log } from 'console';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

const inGameNameKey = 'commands.verify.options.inGameName.name';

const verifyCommandBuilder = new SlashCommandBuilder()
  .setName(i18n.__({ phrase: 'commands.verify.name', locale: defaultLocale }))
  .setDescription(i18n.__({ phrase: 'commands.verify.description', locale: defaultLocale }))
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: inGameNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.verify.options.inGameName.description',
          locale: defaultLocale,
        })
      )
      .setRequired(true)
  );

const commands = [verifyCommandBuilder];

const verificationCodes = new Map<
  string,
  { rsiProfileName: string; dreadnoughtValidationCode: string }
>();

export async function registerCommands() {
  const CLIENT_ID = process.env.CLIENT_ID;

  if (!CLIENT_ID) {
    logger.error('Missing CLIENT_ID in environment');
    return;
  }

  try {
    logger.info('Started refreshing application (/) commands globally...');
    await discordRestClient.put(Routes.applicationCommands(CLIENT_ID), {
      body: commands.map((command) => command.toJSON()),
    });
    logger.info('Successfully registered global slash commands.');
  } catch (error) {
    logger.error('Error registering verify command:', error);
  }
}

export async function handleVerifyCommand(interaction: ChatInputCommandInteraction) {
  const locale = interaction.guild?.preferredLocale?.substring(0, 2) || defaultLocale;

  const optionName = i18n.__({ phrase: inGameNameKey, locale: defaultLocale });
  const rsiProfileName = interaction.options.getString(optionName, true);
  logger.debug(`VERIFY.TS--> handleVerifyCommand -> RSI Profile Name: ${rsiProfileName}`);

  const dreadnoughtValidationCode = generateDrdntVerificationCode();
  verificationCodes.set(interaction.user.id, { rsiProfileName, dreadnoughtValidationCode });

  const verifyButtonLabel = i18n.__({ phrase: 'commands.verify.buttonLabel', locale });
  const replyMessage = i18n.__mf(
    { phrase: 'commands.verify.replyMessage', locale },
    {
      user: interaction.user.toString(),
      code: dreadnoughtValidationCode,
      verifyButtonLabel,
    }
  );

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('verify')
      .setLabel(verifyButtonLabel)
      .setStyle(ButtonStyle.Success)
  );

  logger.info(
    `Verification initiated by ${interaction.user.tag} in guild "${interaction.guild?.name}" | RSI: ${rsiProfileName} | Code: ${dreadnoughtValidationCode}`
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
