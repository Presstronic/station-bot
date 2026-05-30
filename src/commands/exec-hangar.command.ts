import {
  ChatInputCommandInteraction,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} from 'discord.js';
import { isExecHangarEnabled } from '../config/exec-hangar.config.js';
import { isDatabaseConfigured } from '../services/nominations/db.js';
import {
  getExecHangarStatus,
  manualSyncExecHangar,
  resyncExecHangarFromExternalSource,
  updateExecHangarConfig,
  validateExecHangarCycleOffsetMs,
} from '../services/exec-hangar/exec-hangar-timer.service.js';
import { getLogger } from '../utils/logger.js';
import i18n from '../utils/i18n-config.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const logger = getLogger();
const POSTGRES_INT_MAX = 2_147_483_647;
const POSTGRES_INT_MIN = -2_147_483_648;

export const EXEC_HANGAR_COMMAND_NAME = 'exec-hangar';

function isAdmin(interaction: ChatInputCommandInteraction): boolean {
  return interaction.inGuild() && (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator) ?? false);
}

function parsePositiveWholeNumber(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value <= 0 || value > POSTGRES_INT_MAX) {
    throw new Error(`${fieldName} must be a whole number between 1 and ${POSTGRES_INT_MAX}.`);
  }
  return value;
}

function parseWholeNumber(value: number, fieldName: string): number {
  if (!Number.isInteger(value) || value < POSTGRES_INT_MIN || value > POSTGRES_INT_MAX) {
    throw new Error(`${fieldName} must be a whole number between ${POSTGRES_INT_MIN} and ${POSTGRES_INT_MAX}.`);
  }
  return value;
}

function formatRelativeSync(lastSyncedAt: string, now = new Date()): string {
  const elapsedMs = Math.max(0, now.getTime() - new Date(lastSyncedAt).getTime());
  const elapsedMinutes = Math.floor(elapsedMs / 60_000);
  return `${elapsedMinutes} min ago`;
}

export const execHangarCommandBuilder = new SlashCommandBuilder()
  .setName(EXEC_HANGAR_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.execHangar.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addSubcommand((subcommand) =>
    subcommand
      .setName('status')
      .setDescription(i18n.__({ phrase: 'commands.execHangar.options.status.description', locale: defaultLocale })),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('resync')
      .setDescription(i18n.__({ phrase: 'commands.execHangar.options.resync.description', locale: defaultLocale })),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('sync')
      .setDescription(i18n.__({ phrase: 'commands.execHangar.options.sync.description', locale: defaultLocale }))
      .addIntegerOption((option) =>
        option
          .setName('opens-in')
          .setDescription(i18n.__({ phrase: 'commands.execHangar.options.sync.opensIn', locale: defaultLocale }))
          .setRequired(false),
      )
      .addIntegerOption((option) =>
        option
          .setName('closes-in')
          .setDescription(i18n.__({ phrase: 'commands.execHangar.options.sync.closesIn', locale: defaultLocale }))
          .setRequired(false),
      ),
  )
  .addSubcommand((subcommand) =>
    subcommand
      .setName('config')
      .setDescription(i18n.__({ phrase: 'commands.execHangar.options.config.description', locale: defaultLocale }))
      .addIntegerOption((option) =>
        option
          .setName('open-duration-minutes')
          .setDescription(i18n.__({ phrase: 'commands.execHangar.options.config.openDurationMinutes', locale: defaultLocale }))
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('closed-duration-minutes')
          .setDescription(i18n.__({ phrase: 'commands.execHangar.options.config.closedDurationMinutes', locale: defaultLocale }))
          .setRequired(true),
      )
      .addIntegerOption((option) =>
        option
          .setName('cycle-offset-ms')
          .setDescription(i18n.__({ phrase: 'commands.execHangar.options.config.cycleOffsetMs', locale: defaultLocale }))
          .setRequired(true),
      ),
  );

function requireEnabled(interaction: ChatInputCommandInteraction, locale: string): Promise<boolean> | boolean {
  if (isExecHangarEnabled()) {
    return true;
  }

  return interaction.reply({
    content: i18n.__({ phrase: 'commands.execHangar.responses.disabled', locale }),
    flags: MessageFlags.Ephemeral,
  }).then(() => false);
}

export async function handleExecHangarCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const locale = interaction.locale?.substring(0, 2) ?? defaultLocale;
  const enabled = await requireEnabled(interaction, locale);
  if (!enabled) return;

  if (!interaction.inGuild()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.execHangar.responses.guildOnly', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDatabaseConfigured()) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.execHangar.responses.temporarilyUnavailable', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const subcommand = interaction.options.getSubcommand(false);
  if (!subcommand) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.execHangar.responses.invalidAction', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'status') {
    try {
      const status = await getExecHangarStatus();
      if (!status.initialized || !status.currentState || !status.nextChangeType || status.minutesUntilNextChange === null) {
        await interaction.reply({
          content: i18n.__({ phrase: 'commands.execHangar.responses.uninitialized', locale }),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const nextChangeLabel =
        status.nextChangeType === 'OPEN'
          ? i18n.__({ phrase: 'commands.execHangar.labels.opensIn', locale })
          : i18n.__({ phrase: 'commands.execHangar.labels.closesIn', locale });
      const syncAge = status.lastSyncedAt
        ? formatRelativeSync(status.lastSyncedAt)
        : i18n.__({ phrase: 'commands.execHangar.labels.unknown', locale });
      const warning = status.warningKey
        ? `\n\n${i18n.__({ phrase: `commands.execHangar.responses.${status.warningKey}`, locale })}`
        : '';

      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.execHangar.responses.status', locale },
          {
            currentState: status.currentState,
            nextChangeLabel,
            minutesUntilNextChange: status.minutesUntilNextChange,
            nextChangeType: status.nextChangeType,
            lastSynced: syncAge,
            syncSource: status.syncSource ?? i18n.__({ phrase: 'commands.execHangar.labels.unknown', locale }),
            confidence: status.confidence === 'good'
              ? i18n.__({ phrase: 'commands.execHangar.labels.confidenceGood', locale })
              : i18n.__({ phrase: 'commands.execHangar.labels.confidenceStale', locale }),
            warning,
          },
        ),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn('[exec-hangar] Status request failed', { error });
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.execHangar.responses.temporarilyUnavailable', locale }),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (!isAdmin(interaction)) {
    await interaction.reply({
      content: i18n.__({ phrase: 'commands.execHangar.responses.adminOnly', locale }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (subcommand === 'resync') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      const updated = await resyncExecHangarFromExternalSource();
      await interaction.editReply({
        content: i18n.__mf(
          { phrase: 'commands.execHangar.responses.resynced', locale },
          {
            currentState: updated.currentState ?? 'UNKNOWN',
            nextChangeType: updated.nextChangeType ?? 'UNKNOWN',
          },
        ),
      });
    } catch (error) {
      logger.warn('[exec-hangar] External resync failed', { error });
      await interaction.editReply({
        content: i18n.__({ phrase: 'commands.execHangar.responses.resyncFailed', locale }),
      });
    }
    return;
  }

  if (subcommand === 'sync') {
    const opensIn = interaction.options.getInteger('opens-in');
    const closesIn = interaction.options.getInteger('closes-in');

    if ((opensIn === null && closesIn === null) || (opensIn !== null && closesIn !== null)) {
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.execHangar.responses.syncChoiceRequired', locale }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let minutes: number;
    try {
      minutes = opensIn !== null
        ? parsePositiveWholeNumber(opensIn, 'opens-in')
        : parsePositiveWholeNumber(closesIn ?? 0, 'closes-in');
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error
          ? error.message
          : i18n.__({ phrase: 'commands.execHangar.responses.invalidMinutes', locale }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const nextChangeType = opensIn !== null ? 'OPEN' : 'CLOSE';

    try {
      await manualSyncExecHangar(nextChangeType, minutes);
      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.execHangar.responses.manualSyncSuccess', locale },
          { nextChangeType, minutes },
        ),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn('[exec-hangar] Manual sync failed', { error, nextChangeType, minutes });
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.execHangar.responses.temporarilyUnavailable', locale }),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (subcommand === 'config') {
    let openDurationMinutes: number;
    let closedDurationMinutes: number;
    let cycleOffsetMs: number;
    try {
      openDurationMinutes = parsePositiveWholeNumber(
        interaction.options.getInteger('open-duration-minutes', true),
        'open-duration-minutes',
      );
      closedDurationMinutes = parsePositiveWholeNumber(
        interaction.options.getInteger('closed-duration-minutes', true),
        'closed-duration-minutes',
      );
      cycleOffsetMs = parseWholeNumber(
        interaction.options.getInteger('cycle-offset-ms', true),
        'cycle-offset-ms',
      );
      validateExecHangarCycleOffsetMs(openDurationMinutes, closedDurationMinutes, cycleOffsetMs);
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error
          ? error.message
          : i18n.__({ phrase: 'commands.execHangar.responses.configFailed', locale }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    try {
      await updateExecHangarConfig({
        openDurationMinutes,
        closedDurationMinutes,
        cycleOffsetMs,
      });

      await interaction.reply({
        content: i18n.__mf(
          { phrase: 'commands.execHangar.responses.configUpdated', locale },
          { openDurationMinutes, closedDurationMinutes, cycleOffsetMs },
        ),
        flags: MessageFlags.Ephemeral,
      });
    } catch (error) {
      logger.warn('[exec-hangar] Config update failed', { error });
      await interaction.reply({
        content: i18n.__({ phrase: 'commands.execHangar.responses.configFailed', locale }),
        flags: MessageFlags.Ephemeral,
      });
    }
  }
}
