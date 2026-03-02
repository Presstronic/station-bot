import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { Routes } from 'discord-api-types/v10';
import { discordRestClient } from '../utils/discord-rest-client.ts';
import { generateDrdntVerificationCode } from '../services/verification-code.services.ts';
import { getLogger } from '../utils/logger.ts';
import i18n from '../utils/i18n-config.ts';
import { isReadOnlyMode } from '../config/runtime-flags.ts';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export const VERIFY_COMMAND_NAME = 'verify';
export const HEALTHCHECK_COMMAND_NAME = 'healthcheck';

const inGameNameKey = 'commands.verify.options.inGameName.name';

const verifyCommandBuilder = new SlashCommandBuilder()
  .setName(VERIFY_COMMAND_NAME)
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

const healthcheckCommandBuilder = new SlashCommandBuilder()
  .setName(HEALTHCHECK_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.healthcheck.description', locale: defaultLocale }))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

const commands = [verifyCommandBuilder, healthcheckCommandBuilder];

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
    logger.error('Error registering slash commands:', error);
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

export function getRegisteredCommandNames(): string[] {
  return commands.map((command) => command.toJSON().name);
}

export async function handleHealthcheckCommand(interaction: ChatInputCommandInteraction) {
  const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.healthcheck.responses.guildOnly', locale }),
      ephemeral: true,
    });
    return;
  }

  const hasAdminPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

  if (!hasAdminPermission) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.healthcheck.responses.adminOnly', locale }),
      ephemeral: true,
    });
    return;
  }

  const botTag = interaction.client.user?.tag ?? 'unknown-bot';
  const currentUtc = new Date().toISOString();
  const activeCommands = getRegisteredCommandNames().map((name) => `/${name}`).join(', ');
  const readOnlyStatus = isReadOnlyMode()
    ? i18n.__({ phrase: 'commands.healthcheck.readOnly.enabled', locale })
    : i18n.__({ phrase: 'commands.healthcheck.readOnly.disabled', locale });

  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.healthcheck.responses.status', locale },
      {
        botTag,
        currentUtc,
        readOnlyStatus,
        activeCommands,
      }
    ),
    ephemeral: true,
  });
}
