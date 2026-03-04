import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.ts';
import {
  addReviewProcessRoleId,
  getReviewProcessRoleIds,
  removeReviewProcessRoleId,
  resetReviewProcessRoleIds,
} from '../services/nominations/access-control.repository.ts';
import {
  ensureAdmin,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.ts';
import { getLogger } from '../utils/logger.ts';

const logger = getLogger();
const defaultLocale = process.env.DEFAULT_LOCALE || 'en';

const accessActionNameKey = 'commands.nominationAccess.options.action.name';
const accessRoleNameKey = 'commands.nominationAccess.options.role.name';

export const NOMINATION_ACCESS_COMMAND_NAME = 'nomination-access';

type AccessAction = 'add' | 'remove' | 'list' | 'reset';

export const nominationAccessCommandBuilder = new SlashCommandBuilder()
  .setName(NOMINATION_ACCESS_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.nominationAccess.description', locale: defaultLocale }))
  .setDMPermission(false)
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addStringOption((option) =>
    option
      .setName(i18n.__({ phrase: accessActionNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominationAccess.options.action.description',
          locale: defaultLocale,
        })
      )
      .addChoices(
        { name: 'add', value: 'add' },
        { name: 'remove', value: 'remove' },
        { name: 'list', value: 'list' },
        { name: 'reset', value: 'reset' }
      )
      .setRequired(true)
  )
  .addRoleOption((option) =>
    option
      .setName(i18n.__({ phrase: accessRoleNameKey, locale: defaultLocale }))
      .setDescription(
        i18n.__({
          phrase: 'commands.nominationAccess.options.role.description',
          locale: defaultLocale,
        })
      )
      .setRequired(false)
  );

function formatRoleIds(roleIds: string[]): string {
  return roleIds.length > 0 ? roleIds.join(', ') : 'none';
}

export async function handleNominationAccessCommand(interaction: ChatInputCommandInteraction) {
  const locale = getCommandLocale(interaction);

  try {
    if (!(await ensureAdmin(interaction))) {
      return;
    }

    const action = interaction.options.getString(
      i18n.__({ phrase: accessActionNameKey, locale: defaultLocale }),
      true
    ) as AccessAction;
    const role = interaction.options.getRole(i18n.__({ phrase: accessRoleNameKey, locale: defaultLocale }));

    if ((action === 'add' || action === 'remove') && !role) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationAccess.responses.roleRequired', locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'add') {
      const result = await addReviewProcessRoleId(role!.id);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominationAccess.responses.added', locale },
          {
            roleMention: `@${role!.name}`,
            changed: result.added ? 'yes' : 'no',
            roles: formatRoleIds(result.roleIds),
          }
        ),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'remove') {
      const result = await removeReviewProcessRoleId(role!.id);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominationAccess.responses.removed', locale },
          {
            roleMention: `@${role!.name}`,
            changed: result.removed ? 'yes' : 'no',
            roles: formatRoleIds(result.roleIds),
          }
        ),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'reset') {
      await resetReviewProcessRoleIds();
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.nominationAccess.responses.reset', locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    const roleIds = await getReviewProcessRoleIds();
    await interaction.reply({
      content: i18n.__mf(
        { phrase: 'commands.nominationAccess.responses.list', locale },
        { roles: formatRoleIds(roleIds) }
      ),
      ephemeral: true,
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`nomination-access command failed: ${errorMessage}`);
    const phrase = isNominationConfigurationError(error)
      ? 'commands.nominationCommon.responses.configurationError'
      : 'commands.nominationCommon.responses.unexpectedError';
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp({
        content: i18n.__({ phrase, locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    } else {
      await interaction.reply({
        content: i18n.__({ phrase, locale }),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }
  }
}
