import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} from 'discord.js';
import { generateDrdntVerificationCode } from '../services/verification-code.services.ts';
import { getLogger } from '../utils/logger.ts';
import i18n from '../utils/i18n-config.ts';
import { isReadOnlyMode, isVerificationEnabled } from '../config/runtime-flags.ts';
import { getRegisteredCommandNamesState } from './registration-state.ts';
import { toDateString } from '../utils/date.ts';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export const VERIFY_COMMAND_NAME = 'verify';
export const HEALTHCHECK_COMMAND_NAME = 'healthcheck';

const inGameNameKey = 'commands.verify.options.inGameName.name';
const RSI_HANDLE_PATTERN = /^[a-zA-Z0-9_-]{3,60}$/;

export const verifyCommandBuilder = new SlashCommandBuilder()
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

export const healthcheckCommandBuilder = new SlashCommandBuilder()
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
  // Backward-compatible wrapper for older imports.
  const { registerAllCommands } = await import('./register-commands.ts');
  await registerAllCommands();
}

export async function handleVerifyCommand(interaction: ChatInputCommandInteraction) {
  const locale = interaction.guild?.preferredLocale?.substring(0, 2) || defaultLocale;

  if (!isVerificationEnabled()) {
    await interaction.reply({
      content: 'Verification is not available on this server.',
      ephemeral: true,
    });
    return;
  }

  const optionName = i18n.__({ phrase: inGameNameKey, locale: defaultLocale });
  const rsiProfileName = interaction.options.getString(optionName, true).trim();

  if (!RSI_HANDLE_PATTERN.test(rsiProfileName)) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.verify.responses.invalidHandle', locale }),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
    return;
  }

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
  const registeredCommandNames = getRegisteredCommandNamesState();
  if (registeredCommandNames.length > 0) {
    return registeredCommandNames;
  }
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
  const currentUtc = toDateString(new Date().toISOString());
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
