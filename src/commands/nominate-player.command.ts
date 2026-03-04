import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import { recordNomination } from '../services/nominations/nominations.repository.ts';
import {
  getCommandLocale,
  getOrganizationMemberRoleName,
  hasOrganizationMemberOrHigher,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();

export const NOMINATE_PLAYER_COMMAND_NAME = 'nominate-player';

const rsiHandleNameKey = 'commands.nominatePlayer.options.rsiHandle.name';
const reasonNameKey = 'commands.nominatePlayer.options.reason.name';

export const nominatePlayerCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATE_PLAYER_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominatePlayer.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: rsiHandleNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominatePlayer.options.rsiHandle.description',
          locale: defaultLocale,
        })
      )
      .setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: reasonNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominatePlayer.options.reason.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

function trimHandle(handle: string): string {
  return handle.trim();
}

export async function handleNominatePlayerCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);
  try {
    if (!interaction.inGuild()) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.guildOnly', locale }),
        ephemeral: true,
      });
      return;
    }

    const allowed = await hasOrganizationMemberOrHigher(interaction);
    if (!allowed) {
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominatePlayer.responses.roleRequired', locale },
          { roleName: getOrganizationMemberRoleName() }
        ),
        ephemeral: true,
      });
      return;
    }

    const rsiHandle = trimHandle(
      interaction.options.getString(i18n.__({ phrase: rsiHandleNameKey, locale: defaultLocale }), true)
    );
    const reason =
      interaction.options.getString(i18n.__({ phrase: reasonNameKey, locale: defaultLocale }))?.trim() || null;

    const updated = await recordNomination(rsiHandle, interaction.user.id, interaction.user.tag, reason);
    await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.nominatePlayer.responses.created', locale },
        {
          rsiHandle: updated.displayHandle,
          nominationCount: String(updated.nominationCount),
        }
      ),
      ephemeral: true,
    });
  } catch (error) {
    logger.error(`nominate-player command failed: ${String(error)}`);
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
        ephemeral: true,
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
        ephemeral: true,
      });
    }
  }
}
