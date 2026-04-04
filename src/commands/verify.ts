import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { generateDrdntVerificationCode } from '../services/verification-code.services.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';
import { isReadOnlyMode, isVerificationEnabled, verifyRateLimitPerMinute, verifyRateLimitPerHour } from '../config/runtime-flags.js';
import { getRegisteredCommandNamesState } from './registration-state.js';
import { toDateString } from '../utils/date.js';

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

const verifyInvocationTimestamps = new Map<string, number[]>();

setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [userId, timestamps] of verifyInvocationTimestamps) {
    if (timestamps[timestamps.length - 1] <= cutoff) {
      verifyInvocationTimestamps.delete(userId);
    }
  }
}, 60 * 60 * 1000).unref();

export async function registerCommands() {
  // Backward-compatible wrapper for older imports.
  const { registerAllCommands } = await import('./register-commands.js');
  await registerAllCommands();
}

export async function handleVerifyCommand(interaction: ChatInputCommandInteraction) {
  const locale = interaction.guild?.preferredLocale?.substring(0, 2) || defaultLocale;

  if (!isVerificationEnabled()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.verify.responses.disabled', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const userId = interaction.user.id;
  const now = Date.now();
  const oneHourAgo = now - 60 * 60 * 1000;
  const oneMinuteAgo = now - 60 * 1000;

  const timestamps = (verifyInvocationTimestamps.get(userId) ?? []).filter(t => t > oneHourAgo);
  if (timestamps.length > 0) {
    verifyInvocationTimestamps.set(userId, timestamps);
  } else {
    verifyInvocationTimestamps.delete(userId);
  }

  const recentTimestamps = timestamps.filter(t => t > oneMinuteAgo);
  const perMinuteLimit = verifyRateLimitPerMinute();
  if (recentTimestamps.length >= perMinuteLimit) {
    const limitingTimestamp = recentTimestamps[recentTimestamps.length - perMinuteLimit];
    const secondsRemaining = Math.ceil((limitingTimestamp + 60 * 1000 - now) / 1000);
    await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.verify.responses.rateLimitMinute', locale },
        { seconds: String(secondsRemaining) }
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const perHourLimit = verifyRateLimitPerHour();
  if (timestamps.length >= perHourLimit) {
    const limitingTimestamp = timestamps[timestamps.length - perHourLimit];
    const minutesRemaining = Math.ceil((limitingTimestamp + 60 * 60 * 1000 - now) / (60 * 1000));
    await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.verify.responses.rateLimitHour', locale },
        { minutes: String(minutesRemaining) }
      ),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  timestamps.push(now);
  verifyInvocationTimestamps.set(userId, timestamps);

  const optionName = i18n.__({ phrase: inGameNameKey, locale: defaultLocale });
  const rsiProfileName = interaction.options.getString(optionName, true).trim();

  if (!RSI_HANDLE_PATTERN.test(rsiProfileName)) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.verify.responses.invalidHandle', locale }),
      flags: MessageFlags.Ephemeral,
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
    `Verification initiated by ${interaction.user.username} in guild "${interaction.guild?.name}" | RSI: ${rsiProfileName} | Code: ${dreadnoughtValidationCode}`
  );

  await interaction.reply({
    content: replyMessage,
    components: [row],
    flags: MessageFlags.Ephemeral,
  });
}

export function getUserVerificationData(userId: string) {
  return verificationCodes.get(userId);
}

export function clearUserVerificationData(userId: string): void {
  verificationCodes.delete(userId);
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
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const hasAdminPermission = interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false;

  if (!hasAdminPermission) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.healthcheck.responses.adminOnly', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const botUsername = interaction.client.user?.username ?? 'unknown-bot';
  const currentUtc = toDateString(new Date().toISOString());
  const activeCommands = getRegisteredCommandNames().map((name) => `/${name}`).join(', ');
  const readOnlyStatus = isReadOnlyMode()
    ? i18n.__({ phrase: 'commands.healthcheck.readOnly.enabled', locale })
    : i18n.__({ phrase: 'commands.healthcheck.readOnly.disabled', locale });

  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.healthcheck.responses.status', locale },
      {
        botTag: botUsername,
        currentUtc,
        readOnlyStatus,
        activeCommands,
      }
    ),
    flags: MessageFlags.Ephemeral,
  });
}
