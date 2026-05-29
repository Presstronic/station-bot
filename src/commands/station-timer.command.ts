import {
  ChatInputCommandInteraction,
  MessageFlags,
  SlashCommandBuilder,
} from 'discord.js';
import i18n from '../utils/i18n-config.js';
import {
  isStationTimerEnabled,
} from '../config/station-timer.config.js';
import {
  listStationTimersForUser,
  normalizeStationTimerMinutes,
  startStationTimer,
  stopStationTimerForUser,
} from '../services/station-timer/station-timer.service.js';
import { isDatabaseConfigured } from '../services/nominations/db.js';

const defaultLocale = process.env.DEFAULT_LOCALE || 'en';
const MAX_STATION_TIMER_MINUTES = 240;

export const STATION_TIMER_COMMAND_NAME = 'station-timer';

type StationTimerAction = 'start' | 'stop' | 'list';
type StationTimerType = 'CZ' | 'Hathor';

export const stationTimerCommandBuilder = new SlashCommandBuilder()
  .setName(STATION_TIMER_COMMAND_NAME)
  .setDescription(i18n.__({ phrase: 'commands.stationTimer.description', locale: defaultLocale }))
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('action')
      .setDescription(i18n.__({ phrase: 'commands.stationTimer.options.action.description', locale: defaultLocale }))
      .setRequired(false)
      .addChoices(
        { name: 'Start', value: 'start' },
        { name: 'Stop', value: 'stop' },
        { name: 'List', value: 'list' },
      ),
  )
  .addStringOption((option) =>
    option
      .setName('type')
      .setDescription(i18n.__({ phrase: 'commands.stationTimer.options.type.description', locale: defaultLocale }))
      .setRequired(false)
      .addChoices(
        { name: 'CZ', value: 'CZ' },
        { name: 'Hathor', value: 'Hathor' },
      ),
  )
  .addIntegerOption((option) =>
    option
      .setName('time')
      .setDescription(i18n.__({ phrase: 'commands.stationTimer.options.time.description', locale: defaultLocale }))
      .setRequired(false)
      .setMinValue(1)
      .setMaxValue(MAX_STATION_TIMER_MINUTES),
  )
  .addIntegerOption((option) =>
    option
      .setName('id')
      .setDescription(i18n.__({ phrase: 'commands.stationTimer.options.id.description', locale: defaultLocale }))
      .setRequired(false)
      .setMinValue(1),
  );

function getLocale(interaction: ChatInputCommandInteraction): string {
  return interaction.locale?.substring(0, 2) ?? defaultLocale;
}

function reply(interaction: ChatInputCommandInteraction, content: string) {
  return interaction.reply({
    content,
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] },
  });
}

function parseAction(raw: string | null): StationTimerAction {
  if (raw === 'stop' || raw === 'list') {
    return raw;
  }
  return 'start';
}

function parseTimerType(raw: string | null): StationTimerType {
  if (raw === 'Hathor') {
    return 'Hathor';
  }
  return 'CZ';
}

function formatListLine(locale: string, values: { id: number; type: string; duration: number; remainingMinutes: number }): string {
  return i18n.__mf(
    { phrase: 'commands.stationTimer.responses.list.line', locale },
    values,
  );
}

async function handleStart(interaction: ChatInputCommandInteraction, locale: string): Promise<void> {
  const type = parseTimerType(interaction.options.getString('type'));
  const minutes = normalizeStationTimerMinutes(interaction.options.getInteger('time'));

  if (minutes < 1 || minutes > MAX_STATION_TIMER_MINUTES) {
    await reply(
      interaction,
      i18n.__mf(
        { phrase: 'commands.stationTimer.responses.start.invalidTime', locale },
        { maxMinutes: MAX_STATION_TIMER_MINUTES },
      ),
    );
    return;
  }

  const memberDisplayName =
    interaction.member && 'displayName' in interaction.member
      ? String(interaction.member.displayName)
      : interaction.user.username;

  const result = await startStationTimer({
    guildId: interaction.guildId!,
    discordUserId: interaction.user.id,
    starterDisplayName: memberDisplayName,
    timerLabel: type,
    durationMinutes: minutes,
  });

  if (!result.ok) {
    const phrase =
      result.reason === 'user-cap'
        ? 'commands.stationTimer.responses.start.userCapReached'
        : 'commands.stationTimer.responses.start.guildCapReached';
    await reply(interaction, i18n.__({ phrase, locale }));
    return;
  }

  await reply(
    interaction,
    i18n.__mf(
      { phrase: 'commands.stationTimer.responses.start.success', locale },
      {
        durationMinutes: result.timer.durationMinutes,
        timerType: result.timer.timerLabel,
        timerId: result.timer.userTimerId,
      },
    ),
  );
}

async function handleList(interaction: ChatInputCommandInteraction, locale: string): Promise<void> {
  const timers = await listStationTimersForUser(interaction.guildId!, interaction.user.id);
  if (timers.length === 0) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.list.none', locale }));
    return;
  }

  const lines = timers.map(({ timer, remainingMinutes }) =>
    formatListLine(locale, {
      id: timer.userTimerId,
      type: timer.timerLabel,
      duration: timer.durationMinutes,
      remainingMinutes,
    }),
  );

  await reply(
    interaction,
    i18n.__mf(
      { phrase: 'commands.stationTimer.responses.list.header', locale },
      { timers: lines.join('\n') },
    ),
  );
}

async function handleStop(interaction: ChatInputCommandInteraction, locale: string): Promise<void> {
  const id = interaction.options.getInteger('id');
  if (id == null) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.stop.idRequired', locale }));
    return;
  }

  const stopped = await stopStationTimerForUser(interaction.guildId!, interaction.user.id, id);
  if (!stopped) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.stop.notFound', locale }));
    return;
  }

  await reply(
    interaction,
    i18n.__mf(
      { phrase: 'commands.stationTimer.responses.stop.success', locale },
      {
        timerId: stopped.userTimerId,
        durationMinutes: stopped.durationMinutes,
        timerType: stopped.timerLabel,
      },
    ),
  );
}

export async function handleStationTimerCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const locale = getLocale(interaction);

  if (!interaction.inGuild()) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.guildOnly', locale }));
    return;
  }

  if (!isStationTimerEnabled()) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.disabled', locale }));
    return;
  }

  if (!isDatabaseConfigured()) {
    await reply(interaction, i18n.__({ phrase: 'commands.stationTimer.responses.unavailable', locale }));
    return;
  }

  const action = parseAction(interaction.options.getString('action'));
  if (action === 'list') {
    await handleList(interaction, locale);
    return;
  }

  if (action === 'stop') {
    await handleStop(interaction, locale);
    return;
  }

  await handleStart(interaction, locale);
}
