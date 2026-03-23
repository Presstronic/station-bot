import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChatInputCommandInteraction,
  ComponentType,
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
const CONFIRM_TIMEOUT_MS = 60_000;

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
      const currentRoleIds = await getReviewProcessRoleIds();

      if (currentRoleIds.length === 0) {
        await interaction.reply({
          content: i18n.__({ phrase: 'commands.nominationAccess.responses.resetNoRoles', locale }),
          ephemeral: true,
          allowedMentions: { parse: [] },
        });
        return;
      }

      const roleMentions = currentRoleIds.map((id) => `<@&${id}>`).join(', ');
      const confirmResetId = `confirm-reset-${interaction.id}`;
      const cancelId = `cancel-reset-${interaction.id}`;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(confirmResetId)
          .setLabel(i18n.__({ phrase: 'commands.nominationAccess.buttons.confirmReset', locale }))
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId(cancelId)
          .setLabel(i18n.__({ phrase: 'commands.nominationAccess.buttons.cancel', locale }))
          .setStyle(ButtonStyle.Secondary),
      );

      const resetResponse = await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.nominationAccess.responses.resetConfirmPrompt', locale },
          { count: String(currentRoleIds.length), roles: roleMentions }
        ),
        components: [row],
        ephemeral: true,
        allowedMentions: { parse: [] },
        fetchReply: true,
      });

      let resetConfirmation: Awaited<ReturnType<typeof resetResponse.awaitMessageComponent>>;
      try {
        resetConfirmation = await resetResponse.awaitMessageComponent({
          componentType: ComponentType.Button,
          filter: (i) => i.user.id === interaction.user.id,
          time: CONFIRM_TIMEOUT_MS,
        });
      } catch (err) {
        logger.error(`awaitMessageComponent failed for reset confirmation: ${String(err)}`);
        const isTimeout = err instanceof Error && /reason:\s*time/i.test(err.message);
        await interaction.editReply({
          content: isTimeout
            ? i18n.__({ phrase: 'commands.nominationAccess.responses.resetTimeout', locale })
            : i18n.__({ phrase: 'commands.nominationCommon.responses.unexpectedError', locale }),
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }

      if (resetConfirmation.customId === cancelId) {
        await resetConfirmation.update({
          content: i18n.__({ phrase: 'commands.nominationAccess.responses.resetCancelled', locale }),
          components: [],
          allowedMentions: { parse: [] },
        });
        return;
      }

      // Confirmed — perform reset
      await resetConfirmation.deferUpdate();
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
        const phrase = isNominationConfigurationError(err)
          ? 'commands.nominationCommon.responses.configurationError'
          : 'commands.nominationCommon.responses.unexpectedError';
        await interaction.editReply({ content: i18n.__({ phrase, locale }), components: [], allowedMentions: { parse: [] } });
        return;
      }
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.nominationAccess.responses.reset', locale }),
        components: [],
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
