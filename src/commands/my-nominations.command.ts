import { ChatInputCommandInteraction, MessageFlags, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.js';
import { getNominationCountsByUser } from '../services/nominations/nominations.repository.js';
import { getCommandLocale, isNominationConfigurationError } from './nomination.helpers.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

export const MY_NOMINATIONS_COMMAND_NAME = 'my-nominations';

export const myNominationsCommandBuilder = new SlashCommandBuilder()
  .setName(MY_NOMINATIONS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.myNominations.description', locale: defaultLocale }))
  .setDMPermission(false);

function formatNominationCount(count: number): string {
  return `${count} nomination${count === 1 ? '' : 's'}`;
}

export async function handleMyNominationsCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    const history = await getNominationCountsByUser(interaction.user.id);

    if (history.length === 0) {
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.myNominations.responses.none', locale }),
        allowedMentions: { parse: [] },
      });
      return;
    }

    const yearlyLines = history.map(({ year, count }) => `${year}: ${formatNominationCount(count)}`);
    const lifetimeTotal = history.reduce((sum, { count }) => sum + count, 0);

    await interaction.editReply({
      content: [
        i18n.__({ phrase: 'commands.myNominations.responses.historyTitle', locale }),
        ...yearlyLines,
        '──────────────────────',
        i18n.__mf(
          { phrase: 'commands.myNominations.responses.lifetimeTotal', locale },
          { count: formatNominationCount(lifetimeTotal) }
        ),
      ].join('\n'),
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`my-nominations command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';

    await interaction.editReply({
      content: i18n.__({ phrase, locale }),
      allowedMentions: { parse: [] },
    });
  }
}
