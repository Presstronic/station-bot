import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import {
  markAllNominationsProcessed,
  markNominationProcessedByHandle,
} from '../services/nominations/nominations.repository.ts';
import { ensureAdmin, getCommandLocale } from './nomination.helpers.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const processHandleKey = 'commands.processNomination.options.rsiHandle.name';

export const PROCESS_NOMINATION_COMMAND_NAME = 'process-nomination';

export const processNominationCommandBuilder = new SlashCommandBuilder()
  .setName(PROCESS_NOMINATION_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.processNomination.description', locale: defaultLocale }))
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: processHandleKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.processNomination.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

export async function handleProcessNominationCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  if (!(await ensureAdmin(interaction))) {
    return;
  }

  const handle =
    interaction.options.getString(i18n.__({ phrase: processHandleKey, locale: defaultLocale }))?.trim() || null;

  if (handle) {
    const updated = markNominationProcessedByHandle(handle, interaction.user.id);
    await interaction.reply({
      content: updated
        ? i18n.__mf(
            { phrase: 'commands.processNomination.responses.singleProcessed', locale },
            { rsiHandle: handle }
          )
        : i18n.__mf(
            { phrase: 'commands.processNomination.responses.singleNotFound', locale },
            { rsiHandle: handle }
          ),
      ephemeral: true,
    });
    return;
  }

  const count = markAllNominationsProcessed(interaction.user.id);
  await interaction.reply({
    content: i18n.__mf(
      { phrase: 'commands.processNomination.responses.allProcessed', locale },
      { processedCount: String(count) }
    ),
    ephemeral: true,
  });
}
