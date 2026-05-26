import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
} from 'discord.js';
import { createRequire } from 'node:module';
import i18n from '../utils/i18n-config.js';
import { isReadOnlyMode } from '../config/runtime-flags.js';
import { toDateString } from '../utils/date.js';
import { getRegisteredCommandNamesState } from './registration-state.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const _require = createRequire(import.meta.url);
const { version: appVersion } = _require('../../package.json') as { version: string };

export const HEALTHCHECK_COMMAND_NAME = 'healthcheck';

export const healthcheckCommandBuilder = new SlashCommandBuilder()
  .setName(HEALTHCHECK_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.healthcheck.description', locale: defaultLocale }))
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .setDMPermission(false);

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
  const activeCommands = getRegisteredCommandNamesState().map((name) => `/${name}`).join(', ');
  const readOnlyStatus = isReadOnlyMode()
    ? i18n.__({ phrase: 'commands.healthcheck.readOnly.enabled', locale })
    : i18n.__({ phrase: 'commands.healthcheck.readOnly.disabled', locale });

  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.healthcheck.responses.status', locale },
      {
        botTag: botUsername,
        appVersion,
        currentUtc,
        readOnlyStatus,
        activeCommands,
      }
    ),
    flags: MessageFlags.Ephemeral,
  });
}
