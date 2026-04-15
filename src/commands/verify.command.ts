import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from 'discord.js';
import { generateDrdntVerificationCode } from '../services/verification-code.services.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';
import {
  isVerificationEnabled,
  verifyRateLimitPerMinute,
  verifyRateLimitPerHour,
  verifySessionTtlMinutes,
} from '../config/runtime-flags.js';
import { getRsiProfileEditUrl } from '../config/rsi.config.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export const VERIFY_COMMAND_NAME = 'verify';

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

// IN-PROCESS STORE — not persisted across restarts and not shared across instances.
// Users mid-verification will receive a session-expired response after a bot restart.
// Multi-instance deployments require a shared store (e.g. Redis or Postgres) — see #317.
const verificationCodes = new Map<
  string,
  { rsiProfileName: string; dreadnoughtValidationCode: string; createdAt: number }
>();

const SESSION_TTL_MS = verifySessionTtlMinutes() * 60 * 1000;

export function purgeExpiredVerificationSessions(): void {
  const now = Date.now();
  for (const [userId, session] of verificationCodes) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      verificationCodes.delete(userId);
    }
  }
}

setInterval(() => {
  purgeExpiredVerificationSessions();
}, SESSION_TTL_MS).unref();

// IN-PROCESS STORE — not persisted across restarts and not shared across instances.
// Rate-limit windows reset on bot restart; multi-instance deployments require a shared store — see #317.
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

  logger.debug(`handleVerifyCommand -> RSI Profile Name: ${rsiProfileName}`);

  const dreadnoughtValidationCode = generateDrdntVerificationCode();
  verificationCodes.set(interaction.user.id, { rsiProfileName, dreadnoughtValidationCode, createdAt: now });

  const verifyButtonLabel = i18n.__({ phrase: 'commands.verify.buttonLabel', locale });
  const replyMessage = i18n.__mf(
    { phrase: 'commands.verify.replyMessage', locale },
    {
      user: interaction.user.toString(),
      code: dreadnoughtValidationCode,
      verifyButtonLabel,
      rsiProfileEditUrl: getRsiProfileEditUrl(),
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
  const session = verificationCodes.get(userId);
  if (!session) return undefined;
  if (Date.now() - session.createdAt > SESSION_TTL_MS) {
    verificationCodes.delete(userId);
    return undefined;
  }
  return session;
}

export function clearUserVerificationData(userId: string): void {
  verificationCodes.delete(userId);
}
