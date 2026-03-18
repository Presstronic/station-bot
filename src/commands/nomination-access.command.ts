import {
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import {
  addReviewProcessRoleId,
  getReviewProcessRoleIds,
  removeReviewProcessRoleId,
  resetReviewProcessRoleIds,
} from '../services/nominations/access-control.repository.js';
import {
  ensureAdmin,
  getCommandLocale,
  isNominationConfigurationError,
} from './nomination.helpers.js';
import { recordAuditEvent } from '../services/nominations/audit.repository.js';
import { getLogger } from '../utils/logger.js';

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
      let addResult: Awaited<ReturnType<typeof addReviewProcessRoleId>>;
      try {
        addResult = await addReviewProcessRoleId(role!.id);
        recordAuditEvent({
          eventType: 'nomination_access_role_added',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetRoleId: role!.id,
          payloadJson: { changed: addResult.added },
          result: 'success',
        }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
      } catch (err) {
        recordAuditEvent({
          eventType: 'nomination_access_role_added',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetRoleId: role!.id,
          result: 'failure',
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
        throw err;
      }
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominationAccess.responses.added', locale },
          {
            roleMention: `@${role!.name}`,
            changed: addResult.added ? 'yes' : 'no',
            roles: formatRoleIds(addResult.roleIds),
          }
        ),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'remove') {
      let removeResult: Awaited<ReturnType<typeof removeReviewProcessRoleId>>;
      try {
        removeResult = await removeReviewProcessRoleId(role!.id);
        recordAuditEvent({
          eventType: 'nomination_access_role_removed',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetRoleId: role!.id,
          payloadJson: { changed: removeResult.removed },
          result: 'success',
        }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
      } catch (err) {
        recordAuditEvent({
          eventType: 'nomination_access_role_removed',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          targetRoleId: role!.id,
          result: 'failure',
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
        throw err;
      }
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominationAccess.responses.removed', locale },
          {
            roleMention: `@${role!.name}`,
            changed: removeResult.removed ? 'yes' : 'no',
            roles: formatRoleIds(removeResult.roleIds),
          }
        ),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
      return;
    }

    if (action === 'reset') {
      try {
        await resetReviewProcessRoleIds();
        recordAuditEvent({
          eventType: 'nomination_access_roles_reset',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          result: 'success',
        }).catch((err) => logger.error(`audit write failed: ${String(err)}`));
      } catch (err) {
        recordAuditEvent({
          eventType: 'nomination_access_roles_reset',
          actorUserId: interaction.user.id,
          actorUserTag: interaction.user.tag,
          result: 'failure',
          errorMessage: err instanceof Error ? err.message : String(err),
        }).catch((auditErr) => logger.error(`audit write failed: ${String(auditErr)}`));
        throw err;
      }
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
