import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  PermissionFlagsBits,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuInteraction,
  TextInputBuilder,
  TextInputStyle,
  type GuildBasedChannel,
  type Guild,
  type Role,
} from 'discord.js';
import cron from 'node-cron';
import { isVerificationEnabled } from '../config/runtime-flags.js';
import { isNominationDigestEnabled } from '../config/nomination-digest.config.js';
import { isManufacturingEnabled } from '../config/manufacturing.config.js';
import {
  getGuildConfigOrNull,
  upsertGuildConfig,
  type GuildConfig,
  type GuildConfigPatch,
} from '../domain/guild-config/guild-config.service.js';
import { rescheduleGuildDigest } from '../jobs/discord/nomination-digest.job.js';
import { rescheduleGuildKeepalive } from '../jobs/discord/manufacturing-keepalive.job.js';
import { rescheduleGuildPurge } from '../jobs/discord/purge-member.job.js';
import { isDatabaseConfigured } from '../services/nominations/db.js';
import { addMissingDefaultRoles } from '../services/role.services.js';

export const CONFIGURE_COMMAND_NAME = 'configure';

const CONFIGURE_MODAL_PREFIX = 'cfg-modal';
const CONFIGURE_OPEN_PREFIX = 'cfg-open';
const CONFIGURE_SKIP_PREFIX = 'cfg-skip';
const CONFIGURE_SAVE_PREFIX = 'cfg-save';
const CONFIGURE_SELECT_FREQ_PREFIX = 'cfg-freq';
const CONFIGURE_SELECT_HOUR_PREFIX = 'cfg-hour';
const CONFIGURE_CONTINUE_PREFIX = 'cfg-continue';

const SESSION_TTL_MS = 15 * 60 * 1000;

type ConfigureFeature = 'verification' | 'nomination-digest' | 'manufacturing' | 'purge-jobs';
type ConfigureMode = 'single' | 'full';
type ScheduleFrequency = 'daily' | 'weekly';

type DraftValue = string | number | boolean | null;

interface ConfigureDraft {
  feature: ConfigureFeature;
  values: Record<string, DraftValue>;
  frequency?: ScheduleFrequency;
  hour?: string;
}

interface ConfigureResult {
  feature: ConfigureFeature;
  status: 'configured' | 'skipped';
  detail: string;
}

interface ConfigureSession {
  guildId: string;
  mode: ConfigureMode;
  features: ConfigureFeature[];
  index: number;
  guildConfig: GuildConfig;
  draft: ConfigureDraft | null;
  results: ConfigureResult[];
  expiresAt: number;
}

const sessions = new Map<string, ConfigureSession>();
const CONFIGURE_FEATURES = [
  'verification',
  'nomination-digest',
  'manufacturing',
  'purge-jobs',
] as const;
const MANUFACTURING_POST_TITLE_MAX_LENGTH = 100;
const MANUFACTURING_POST_MESSAGE_MAX_LENGTH = 2_000;

const sessionCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [sessionId, session] of sessions.entries()) {
    if (session.expiresAt <= now) {
      sessions.delete(sessionId);
    }
  }
}, SESSION_TTL_MS);
sessionCleanupInterval.unref();

export function teardownConfigureCommandForTests(): void {
  clearInterval(sessionCleanupInterval);
}

const configureCommandBuilder = new SlashCommandBuilder()
  .setName(CONFIGURE_COMMAND_NAME)
  .setDescription('Configure guild-specific bot features')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addStringOption((option) =>
    option
      .setName('feature')
      .setDescription('Configure a single feature instead of the full wizard')
      .setRequired(false)
      .addChoices(
        { name: 'Verification', value: 'verification' },
        { name: 'Nomination Digest', value: 'nomination-digest' },
        { name: 'Manufacturing', value: 'manufacturing' },
        { name: 'Purge Jobs', value: 'purge-jobs' },
      ),
  );

export { configureCommandBuilder };

function buildDefaultGuildConfig(guildId: string): GuildConfig {
  return {
    guildId,
    verificationEnabled: true,
    verifiedRoleName: 'Verified',
    tempMemberRoleName: 'Temporary Member',
    potentialApplicantRoleName: 'Potential Applicant',
    orgMemberRoleId: null,
    orgMemberRoleName: null,
    nominationDigestEnabled: false,
    nominationDigestChannelId: null,
    nominationDigestRoleId: null,
    nominationDigestCronSchedule: '0 9 * * *',
    manufacturingEnabled: false,
    manufacturingForumChannelId: null,
    manufacturingStaffChannelId: null,
    manufacturingRoleId: null,
    manufacturingCreateOrderThreadId: null,
    manufacturingOrderLimit: 5,
    manufacturingMaxItemsPerOrder: 10,
    manufacturingOrderRateLimitPer5Min: 1,
    manufacturingOrderRateLimitPerHour: 5,
    manufacturingCreateOrderPostTitle: '📋 Create Order',
    manufacturingCreateOrderPostMessage: 'Click the button below to submit a new manufacturing order.',
    manufacturingKeepaliveCronSchedule: '0 6 * * *',
    purgeJobsEnabled: false,
    tempMemberHoursToExpire: 48,
    tempMemberPurgeCronSchedule: '0 3 * * *',
    birthdayEnabled: false,
    birthdayChannelId: null,
    birthdayCronSchedule: '0 12 * * *',
    eventRemindersEnabled: false,
    eventRemindersDefaultChannelId: null,
    eventRemindersCronSchedule: '*/15 * * * *',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
  };
}

function getCurrentSession(sessionId: string): ConfigureSession | null {
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return session;
}

function getCurrentFeature(session: ConfigureSession): ConfigureFeature | null {
  return session.features[session.index] ?? null;
}

function getFeatureLabel(feature: ConfigureFeature): string {
  switch (feature) {
    case 'verification':
      return 'Verification';
    case 'nomination-digest':
      return 'Nomination Digest';
    case 'manufacturing':
      return 'Manufacturing';
    case 'purge-jobs':
      return 'Purge Jobs';
  }
}

function isFeatureOperatorEnabled(feature: ConfigureFeature): boolean {
  switch (feature) {
    case 'verification':
      return isVerificationEnabled();
    case 'nomination-digest':
      return isNominationDigestEnabled();
    case 'manufacturing':
      return isManufacturingEnabled();
    case 'purge-jobs':
      return true;
  }
}

function parseConfigureFeature(value: string | null): ConfigureFeature | null {
  if (value === null) {
    return null;
  }

  if ((CONFIGURE_FEATURES as readonly string[]).includes(value)) {
    return value as ConfigureFeature;
  }

  throw new Error('Unsupported feature selected. Run `/configure` again and choose a listed feature.');
}

function buildFeaturePrompt(sessionId: string, feature: ConfigureFeature): {
  content: string;
  components: ActionRowBuilder<ButtonBuilder>[];
} {
  return {
    content: `Configure **${getFeatureLabel(feature)}** for this server.`,
    components: [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(`${CONFIGURE_OPEN_PREFIX}:${sessionId}:${feature}`)
          .setLabel(`Configure ${getFeatureLabel(feature)}`)
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`${CONFIGURE_SKIP_PREFIX}:${sessionId}:${feature}`)
          .setLabel('Skip')
          .setStyle(ButtonStyle.Secondary),
      ),
    ],
  };
}

function buildScheduleSummary(frequency?: ScheduleFrequency, hour?: string): string {
  const frequencyLabel =
    frequency === 'daily'
      ? 'Daily'
      : frequency === 'weekly'
        ? 'Weekly (Sunday UTC)'
        : 'Not selected';
  const hourLabel = hour !== undefined ? `${hour}:00 UTC` : 'Not selected';
  return `Frequency: ${frequencyLabel}\nTime: ${hourLabel}`;
}

function buildScheduleComponents(sessionId: string, feature: ConfigureFeature, draft: ConfigureDraft): ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[] {
  const frequencyRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CONFIGURE_SELECT_FREQ_PREFIX}:${sessionId}:${feature}`)
      .setPlaceholder('Choose frequency')
      .addOptions(
        { label: 'Daily', value: 'daily', default: draft.frequency === 'daily' },
        { label: 'Weekly', value: 'weekly', default: draft.frequency === 'weekly' },
      ),
  );

  const hourRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${CONFIGURE_SELECT_HOUR_PREFIX}:${sessionId}:${feature}`)
      .setPlaceholder('Choose UTC hour')
      .addOptions(
        Array.from({ length: 24 }, (_, hour) => {
          const label = `${hour.toString().padStart(2, '0')}:00 UTC`;
          return {
            label,
            value: hour.toString().padStart(2, '0'),
            default: draft.hour === hour.toString().padStart(2, '0'),
          };
        }),
      ),
  );

  const saveRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CONFIGURE_SAVE_PREFIX}:${sessionId}:${feature}`)
      .setLabel('Save')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(!draft.frequency || !draft.hour),
  );

  return [frequencyRow, hourRow, saveRow];
}

function buildSchedulePrompt(sessionId: string, feature: ConfigureFeature, draft: ConfigureDraft): {
  content: string;
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
} {
  return {
    content: `Finish configuring **${getFeatureLabel(feature)}**.\n${buildScheduleSummary(draft.frequency, draft.hour)}`,
    components: buildScheduleComponents(sessionId, feature, draft),
  };
}

function buildScheduleErrorPrompt(sessionId: string, feature: ConfigureFeature, draft: ConfigureDraft, message: string): {
  content: string;
  components: ActionRowBuilder<StringSelectMenuBuilder | ButtonBuilder>[];
} {
  const prompt = buildSchedulePrompt(sessionId, feature, draft);
  return {
    ...prompt,
    content: `${message}\n\n${prompt.content}`,
  };
}

function buildWizardSummary(session: ConfigureSession): string {
  const lines = session.results.map((result) => {
    const prefix = result.status === 'configured' ? 'Configured' : 'Skipped';
    return `- ${prefix}: ${getFeatureLabel(result.feature)} — ${result.detail}`;
  });

  return lines.length > 0
    ? `Configuration complete.\n${lines.join('\n')}`
    : 'Configuration complete.';
}

function buildContactOperatorMessage(feature: ConfigureFeature): string {
  return `${getFeatureLabel(feature)} is currently disabled by the bot operator. Contact your operator to enable it globally.`;
}

function buildUnavailableMessage(): string {
  return 'Configuration is currently unavailable because the database is not configured.';
}

function buildConfigLoadFailedMessage(): string {
  return 'Configuration could not be loaded right now. Please try again in a moment.';
}

function parseCronHour(value: string): number {
  return Number.parseInt(value, 10);
}

function buildCronFromSelection(frequency: ScheduleFrequency, hour: string): string {
  const cronHour = parseCronHour(hour);
  switch (frequency) {
    case 'daily':
      return `0 ${cronHour} * * *`;
    case 'weekly':
      return `0 ${cronHour} * * 0`;
  }
}

function parseScheduleFrequency(value: string): ScheduleFrequency {
  if (value === 'daily' || value === 'weekly') {
    return value;
  }
  throw new Error('Unsupported schedule frequency selected. Please choose Daily or Weekly.');
}

function parseScheduleHour(value: string): string {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 23) {
    throw new Error('Unsupported UTC hour selected. Please choose an hour from 00 through 23.');
  }
  return parsed.toString().padStart(2, '0');
}

function assertCronSupported(frequency: ScheduleFrequency, hour: string): string {
  const cronExpression = buildCronFromSelection(frequency, hour);
  if (!cron.validate(cronExpression)) {
    throw new Error('The selected schedule could not be converted into a valid cron expression.');
  }
  return cronExpression;
}

function parsePositiveInteger(raw: string, fieldName: string, minimum: number, maximum?: number): number {
  const normalized = raw.trim();
  if (!/^\d+$/.test(normalized)) {
    const boundsMessage =
      maximum === undefined
        ? `a whole number of at least ${minimum}`
        : `a whole number between ${minimum} and ${maximum}`;
    throw new Error(`${fieldName} must be ${boundsMessage}.`);
  }

  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || (maximum !== undefined && parsed > maximum)) {
    const boundsMessage =
      maximum === undefined
        ? `a whole number of at least ${minimum}`
        : `a whole number between ${minimum} and ${maximum}`;
    throw new Error(`${fieldName} must be ${boundsMessage}.`);
  }
  return parsed;
}

function parseDraftPositiveInteger(value: DraftValue, fieldName: string, minimum: number, maximum?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`${fieldName} is missing or invalid. Restart this feature with \`/configure\`.`);
  }

  if (value < minimum || (maximum !== undefined && value > maximum)) {
    const boundsMessage =
      maximum === undefined
        ? `at least ${minimum}`
        : `between ${minimum} and ${maximum}`;
    throw new Error(`${fieldName} must be a whole number ${boundsMessage}. Restart this feature with \`/configure\`.`);
  }

  return value;
}

async function validateGuildRole(guild: Guild, roleId: string, label: string): Promise<Role> {
  try {
    const role = await guild.roles.fetch(roleId);
    if (!role) {
      throw new Error(`${label} is not a valid role ID.`);
    }
    return role;
  } catch {
    throw new Error(`${label} is invalid or the bot cannot access that role.`);
  }
}

async function validateGuildChannel(guild: Guild, channelId: string, label: string): Promise<GuildBasedChannel> {
  try {
    const channel = await guild.channels.fetch(channelId);
    if (!channel) {
      throw new Error(`${label} is not a valid channel ID.`);
    }
    return channel;
  } catch {
    throw new Error(`${label} is invalid or the bot cannot access that channel.`);
  }
}

function isSendableTextChannel(channel: GuildBasedChannel): boolean {
  return channel.isTextBased() && 'send' in channel;
}

function createSession(sessionId: string, guildId: string, features: ConfigureFeature[], mode: ConfigureMode): ConfigureSession {
  const session: ConfigureSession = {
    guildId,
    mode,
    features,
    index: 0,
    guildConfig: buildDefaultGuildConfig(guildId),
    draft: null,
    results: [],
    expiresAt: Date.now() + SESSION_TTL_MS,
  };
  sessions.set(sessionId, session);
  return session;
}

async function loadGuildConfigSnapshot(guildId: string): Promise<GuildConfig> {
  try {
    return (await getGuildConfigOrNull(guildId)) ?? buildDefaultGuildConfig(guildId);
  } catch {
    throw new Error(buildConfigLoadFailedMessage());
  }
}

async function replySessionExpired(interaction: ButtonInteraction | StringSelectMenuInteraction | ModalSubmitInteraction): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp({
      content: 'Your configure session has expired. Run `/configure` again to restart.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply({
    content: 'Your configure session has expired. Run `/configure` again to restart.',
    flags: MessageFlags.Ephemeral,
  });
}

async function finishOrAdvanceFromModal(
  interaction: ModalSubmitInteraction,
  sessionId: string,
  session: ConfigureSession,
  configuredFeature: ConfigureFeature,
  detail: string,
): Promise<void> {
  session.results.push({ feature: configuredFeature, status: 'configured', detail });
  session.index += 1;
  session.draft = null;

  const nextFeature = getCurrentFeature(session);
  if (session.mode === 'single' || nextFeature === null) {
    sessions.delete(sessionId);
    await interaction.editReply({
      content: session.mode === 'single' ? detail : buildWizardSummary(session),
    });
    return;
  }

  await interaction.editReply({
    ...buildFeaturePrompt(sessionId, nextFeature),
  });
}

function buildVerificationModal(sessionId: string, guildConfig: GuildConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CONFIGURE_MODAL_PREFIX}:${sessionId}:verification:base`)
    .setTitle('Configure Verification');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('verified-role-name')
        .setLabel('Verified role name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.verifiedRoleName),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('temp-member-role-name')
        .setLabel('Temporary member role name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.tempMemberRoleName),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('potential-applicant-role-name')
        .setLabel('Potential applicant role name')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.potentialApplicantRoleName),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('org-member-role-id')
        .setLabel('Org member role ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(false)
        .setValue(guildConfig.orgMemberRoleId ?? ''),
    ),
  );

  return modal;
}

function buildNominationDigestModal(sessionId: string, guildConfig: GuildConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CONFIGURE_MODAL_PREFIX}:${sessionId}:nomination-digest:base`)
    .setTitle('Configure Nomination Digest');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('channel-id')
        .setLabel('Digest channel ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.nominationDigestChannelId ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('role-id')
        .setLabel('Digest role ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.nominationDigestRoleId ?? ''),
    ),
  );

  return modal;
}

function buildManufacturingBaseModal(sessionId: string, guildConfig: GuildConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CONFIGURE_MODAL_PREFIX}:${sessionId}:manufacturing:base`)
    .setTitle('Configure Manufacturing');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('forum-channel-id')
        .setLabel('Manufacturing forum channel ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.manufacturingForumChannelId ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('staff-channel-id')
        .setLabel('Manufacturing staff forum ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.manufacturingStaffChannelId ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('role-id')
        .setLabel('Manufacturing role ID')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.manufacturingRoleId ?? ''),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('order-limit')
        .setLabel('Active order limit')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.manufacturingOrderLimit)),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('max-items')
        .setLabel('Max items per order')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.manufacturingMaxItemsPerOrder)),
    ),
  );

  return modal;
}

function buildManufacturingAdvancedModal(sessionId: string, guildConfig: GuildConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CONFIGURE_MODAL_PREFIX}:${sessionId}:manufacturing:advanced`)
    .setTitle('Manufacturing Settings');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('rate-limit-5min')
        .setLabel('Rate limit per 5 minutes')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.manufacturingOrderRateLimitPer5Min)),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('rate-limit-hour')
        .setLabel('Rate limit per hour')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.manufacturingOrderRateLimitPerHour)),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('post-title')
        .setLabel('Create Order post title')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(guildConfig.manufacturingCreateOrderPostTitle),
    ),
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('post-message')
        .setLabel('Create Order post message')
        .setStyle(TextInputStyle.Paragraph)
        .setRequired(true)
        .setValue(guildConfig.manufacturingCreateOrderPostMessage),
    ),
  );

  return modal;
}

function buildPurgeModal(sessionId: string, guildConfig: GuildConfig): ModalBuilder {
  const modal = new ModalBuilder()
    .setCustomId(`${CONFIGURE_MODAL_PREFIX}:${sessionId}:purge-jobs:base`)
    .setTitle('Configure Purge Jobs');

  modal.addComponents(
    new ActionRowBuilder<TextInputBuilder>().addComponents(
      new TextInputBuilder()
        .setCustomId('temp-member-hours')
        .setLabel('Temporary member expiry hours')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setValue(String(guildConfig.tempMemberHoursToExpire)),
    ),
  );

  return modal;
}

async function openFeatureModal(
  interaction: ChatInputCommandInteraction | ButtonInteraction,
  sessionId: string,
  session: ConfigureSession,
): Promise<void> {
  const feature = getCurrentFeature(session);
  if (!feature) {
    throw new Error('This configure step is no longer active. Run `/configure` again if you need to restart.');
  }

  const guildConfig = session.guildConfig;

  switch (feature) {
    case 'verification':
      await interaction.showModal(buildVerificationModal(sessionId, guildConfig));
      return;
    case 'nomination-digest':
      await interaction.showModal(buildNominationDigestModal(sessionId, guildConfig));
      return;
    case 'manufacturing':
      await interaction.showModal(buildManufacturingBaseModal(sessionId, guildConfig));
      return;
    case 'purge-jobs':
      await interaction.showModal(buildPurgeModal(sessionId, guildConfig));
      return;
  }
}

export async function handleConfigureCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'This command requires Manage Server permission and must be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (!isDatabaseConfigured()) {
    await interaction.reply({
      content: buildUnavailableMessage(),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let selectedFeature: ConfigureFeature | null;
  try {
    selectedFeature = parseConfigureFeature(interaction.options.getString('feature', false));
  } catch (error) {
    await interaction.reply({
      content: error instanceof Error ? error.message : 'Unsupported feature selected.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }
  const guildId = interaction.guildId ?? '';

  if (selectedFeature) {
    if (!isFeatureOperatorEnabled(selectedFeature)) {
      await interaction.reply({
        content: buildContactOperatorMessage(selectedFeature),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    let guildConfig: GuildConfig;
    try {
      guildConfig = await loadGuildConfigSnapshot(guildId);
    } catch (error) {
      await interaction.reply({
        content: error instanceof Error ? error.message : buildConfigLoadFailedMessage(),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const session = createSession(interaction.id, guildId, [selectedFeature], 'single');
    session.guildConfig = guildConfig;
    await openFeatureModal(interaction, interaction.id, session);
    return;
  }

  const features = CONFIGURE_FEATURES.filter((feature) => isFeatureOperatorEnabled(feature));

  if (features.length === 0) {
    await interaction.reply({
      content: 'No configurable features are currently enabled by the bot operator.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  let guildConfig: GuildConfig;
  try {
    guildConfig = await loadGuildConfigSnapshot(guildId);
  } catch (error) {
    await interaction.reply({
      content: error instanceof Error ? error.message : buildConfigLoadFailedMessage(),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const session = createSession(interaction.id, guildId, [...features], 'full');
  session.guildConfig = guildConfig;
  await interaction.reply({
    ...buildFeaturePrompt(interaction.id, features[0]),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleVerificationModalSubmit(
  interaction: ModalSubmitInteraction,
  sessionId: string,
  session: ConfigureSession,
): Promise<void> {
  if (!interaction.guild) {
    await interaction.reply({
      content: 'This form can only be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const verifiedRoleName = interaction.fields.getTextInputValue('verified-role-name').trim();
  const tempMemberRoleName = interaction.fields.getTextInputValue('temp-member-role-name').trim();
  const potentialApplicantRoleName = interaction.fields.getTextInputValue('potential-applicant-role-name').trim();
  const orgMemberRoleId = interaction.fields.getTextInputValue('org-member-role-id').trim();

  if (verifiedRoleName.length === 0 || tempMemberRoleName.length === 0 || potentialApplicantRoleName.length === 0) {
    await interaction.reply({
      content: 'Role names cannot be empty.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    if (orgMemberRoleId.length > 0) {
      await validateGuildRole(interaction.guild, orgMemberRoleId, 'Org member role ID');
    }

    const updatedConfig = await upsertGuildConfig(interaction.guildId ?? '', {
      verificationEnabled: true,
      verifiedRoleName,
      tempMemberRoleName,
      potentialApplicantRoleName,
      orgMemberRoleId: orgMemberRoleId.length > 0 ? orgMemberRoleId : null,
    });
    session.guildConfig = updatedConfig;
    await addMissingDefaultRoles(interaction.guild, interaction.client, updatedConfig);
    await finishOrAdvanceFromModal(
      interaction,
      sessionId,
      session,
      'verification',
      'Verification saved and required roles were ensured.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Verification could not be saved.';
    await interaction.editReply({
      content: message,
    });
  }
}

async function handleNominationDigestModalSubmit(
  interaction: ModalSubmitInteraction,
  session: ConfigureSession,
): Promise<void> {
  const channelId = interaction.fields.getTextInputValue('channel-id').trim();
  const roleId = interaction.fields.getTextInputValue('role-id').trim();

  if (channelId.length === 0 || roleId.length === 0) {
    await interaction.reply({
      content: 'Digest channel ID and role ID are required.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  session.draft = {
    feature: 'nomination-digest',
    values: { channelId, roleId },
  };

  await interaction.reply({
    ...buildSchedulePrompt(interaction.customId.split(':')[1], 'nomination-digest', session.draft),
    flags: MessageFlags.Ephemeral,
  });
}

async function handleManufacturingBaseModalSubmit(
  interaction: ModalSubmitInteraction,
  session: ConfigureSession,
): Promise<void> {
  try {
    const forumChannelId = interaction.fields.getTextInputValue('forum-channel-id').trim();
    const staffChannelId = interaction.fields.getTextInputValue('staff-channel-id').trim();
    const roleId = interaction.fields.getTextInputValue('role-id').trim();
    if (forumChannelId.length === 0 || staffChannelId.length === 0 || roleId.length === 0) {
      throw new Error('Manufacturing forum ID, staff forum ID, and role ID are required.');
    }
    const orderLimit = parsePositiveInteger(interaction.fields.getTextInputValue('order-limit'), 'Active order limit', 1);
    const maxItemsPerOrder = parsePositiveInteger(interaction.fields.getTextInputValue('max-items'), 'Max items per order', 1);

    session.draft = {
      feature: 'manufacturing',
      values: {
        forumChannelId,
        staffChannelId,
        roleId,
        orderLimit,
        maxItemsPerOrder,
      },
    };

    await interaction.reply({
      content: 'Step 1 saved. Continue to manufacturing advanced settings.',
      flags: MessageFlags.Ephemeral,
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`${CONFIGURE_CONTINUE_PREFIX}:${interaction.customId.split(':')[1]}:manufacturing`)
            .setLabel('Continue')
            .setStyle(ButtonStyle.Primary),
        ),
      ],
    });
  } catch (error) {
    await interaction.reply({
      content: error instanceof Error ? error.message : 'Manufacturing settings could not be parsed.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handleManufacturingAdvancedModalSubmit(
  interaction: ModalSubmitInteraction,
  session: ConfigureSession,
): Promise<void> {
  if (!session.draft || session.draft.feature !== 'manufacturing') {
    await interaction.reply({
      content: 'Your manufacturing configure session expired. Run `/configure` again.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    session.draft.values.rateLimitPer5Min = parsePositiveInteger(
      interaction.fields.getTextInputValue('rate-limit-5min'),
      'Rate limit per 5 minutes',
      1,
    );
    session.draft.values.rateLimitPerHour = parsePositiveInteger(
      interaction.fields.getTextInputValue('rate-limit-hour'),
      'Rate limit per hour',
      1,
    );
    const postTitle = interaction.fields.getTextInputValue('post-title').trim();
    const postMessage = interaction.fields.getTextInputValue('post-message').trim();

    if (postTitle.length === 0) {
      throw new Error('Create Order post title cannot be empty.');
    }
    if (postTitle.length > MANUFACTURING_POST_TITLE_MAX_LENGTH) {
      throw new Error(`Create Order post title must be ${MANUFACTURING_POST_TITLE_MAX_LENGTH} characters or fewer.`);
    }
    if (postMessage.length === 0) {
      throw new Error('Create Order post message cannot be empty.');
    }
    if (postMessage.length > MANUFACTURING_POST_MESSAGE_MAX_LENGTH) {
      throw new Error(`Create Order post message must be ${MANUFACTURING_POST_MESSAGE_MAX_LENGTH} characters or fewer.`);
    }

    session.draft.values.postTitle = postTitle;
    session.draft.values.postMessage = postMessage;

    await interaction.reply({
      ...buildSchedulePrompt(interaction.customId.split(':')[1], 'manufacturing', session.draft),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await interaction.reply({
      content: error instanceof Error ? error.message : 'Manufacturing settings could not be parsed.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

async function handlePurgeModalSubmit(
  interaction: ModalSubmitInteraction,
  session: ConfigureSession,
): Promise<void> {
  try {
    const tempMemberHoursToExpire = parsePositiveInteger(
      interaction.fields.getTextInputValue('temp-member-hours'),
      'Temporary member expiry hours',
      1,
      720,
    );

    session.draft = {
      feature: 'purge-jobs',
      values: { tempMemberHoursToExpire },
    };

    await interaction.reply({
      ...buildSchedulePrompt(interaction.customId.split(':')[1], 'purge-jobs', session.draft),
      flags: MessageFlags.Ephemeral,
    });
  } catch (error) {
    await interaction.reply({
      content: error instanceof Error ? error.message : 'Purge job settings could not be parsed.',
      flags: MessageFlags.Ephemeral,
    });
  }
}

export async function handleConfigureModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
  const [prefix, sessionId, feature, step] = interaction.customId.split(':');
  if (prefix !== CONFIGURE_MODAL_PREFIX) return;

  const session = getCurrentSession(sessionId);
  if (!session) {
    await replySessionExpired(interaction);
    return;
  }

  if ((interaction.guildId ?? '') !== session.guildId) {
    await interaction.reply({
      content: 'This configure session does not belong to this server. Run `/configure` again to restart.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentFeature = getCurrentFeature(session);
  if (!currentFeature || currentFeature !== feature) {
    await interaction.reply({
      content: 'This configure step is no longer active. Run `/configure` again if you need to restart.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (feature === 'verification' && step === 'base') {
    await handleVerificationModalSubmit(interaction, sessionId, session);
    return;
  }

  if (feature === 'nomination-digest' && step === 'base') {
    await handleNominationDigestModalSubmit(interaction, session);
    return;
  }

  if (feature === 'manufacturing' && step === 'base') {
    await handleManufacturingBaseModalSubmit(interaction, session);
    return;
  }

  if (feature === 'manufacturing' && step === 'advanced') {
    await handleManufacturingAdvancedModalSubmit(interaction, session);
    return;
  }

  if (feature === 'purge-jobs' && step === 'base') {
    await handlePurgeModalSubmit(interaction, session);
    return;
  }

  await interaction.reply({
    content: 'Sorry, something went wrong handling that configuration form. Please try again.',
    flags: MessageFlags.Ephemeral,
  });
}

async function completeConfigurationFromMessage(
  interaction: ButtonInteraction,
  sessionId: string,
  session: ConfigureSession,
  feature: ConfigureFeature,
  detail: string,
): Promise<void> {
  session.results.push({ feature, status: 'configured', detail });
  session.index += 1;
  session.draft = null;

  const nextFeature = getCurrentFeature(session);
  if (session.mode === 'single' || nextFeature === null) {
    sessions.delete(sessionId);
    await interaction.editReply({
      content: session.mode === 'single' ? detail : buildWizardSummary(session),
      components: [],
    });
    return;
  }

  await interaction.editReply({
    ...buildFeaturePrompt(sessionId, nextFeature),
  });
}

async function saveNominationDigest(
  interaction: ButtonInteraction,
  sessionId: string,
  session: ConfigureSession,
): Promise<void> {
  if (!interaction.guild || !session.draft || session.draft.feature !== 'nomination-digest' || !session.draft.frequency || !session.draft.hour) {
    await interaction.update({
      content: 'Nomination digest settings are incomplete. Start the feature again with `/configure`.',
      components: [],
    });
    return;
  }

  const channelId = String(session.draft.values.channelId ?? '').trim();
  const roleId = String(session.draft.values.roleId ?? '').trim();

  try {
    await interaction.deferUpdate();
    const cronExpression = assertCronSupported(session.draft.frequency, session.draft.hour);
    const channel = await validateGuildChannel(interaction.guild, channelId, 'Digest channel ID');
    if (!isSendableTextChannel(channel)) {
      throw new Error('Digest channel ID must point to a text-based channel.');
    }
    await validateGuildRole(interaction.guild, roleId, 'Digest role ID');

    const updatedConfig = await upsertGuildConfig(interaction.guildId ?? '', {
      nominationDigestEnabled: true,
      nominationDigestChannelId: channelId,
      nominationDigestRoleId: roleId,
      nominationDigestCronSchedule: cronExpression,
    });
    session.guildConfig = updatedConfig;
    rescheduleGuildDigest(interaction.client, updatedConfig.guildId, cronExpression);
    await completeConfigurationFromMessage(
      interaction,
      sessionId,
      session,
      'nomination-digest',
      'Nomination digest saved and rescheduled.',
    );
  } catch (error) {
    await interaction.editReply(
      buildScheduleErrorPrompt(
        sessionId,
        'nomination-digest',
        session.draft,
        error instanceof Error ? error.message : 'Nomination digest could not be saved.',
      ),
    );
  }
}

async function saveManufacturing(
  interaction: ButtonInteraction,
  sessionId: string,
  session: ConfigureSession,
): Promise<void> {
  if (!interaction.guild || !session.draft || session.draft.feature !== 'manufacturing' || !session.draft.frequency || !session.draft.hour) {
    await interaction.update({
      content: 'Manufacturing settings are incomplete. Start the feature again with `/configure`.',
      components: [],
    });
    return;
  }

  const values = session.draft.values;
  const forumChannelId = String(values.forumChannelId ?? '').trim();
  const staffChannelId = String(values.staffChannelId ?? '').trim();
  const roleId = String(values.roleId ?? '').trim();

  try {
    await interaction.deferUpdate();
    const cronExpression = assertCronSupported(session.draft.frequency, session.draft.hour);
    const patch: GuildConfigPatch = {
      manufacturingEnabled: true,
      manufacturingForumChannelId: forumChannelId,
      manufacturingStaffChannelId: staffChannelId,
      manufacturingRoleId: roleId,
      manufacturingOrderLimit: parseDraftPositiveInteger(values.orderLimit, 'Active order limit', 1),
      manufacturingMaxItemsPerOrder: parseDraftPositiveInteger(values.maxItemsPerOrder, 'Max items per order', 1),
      manufacturingOrderRateLimitPer5Min: parseDraftPositiveInteger(values.rateLimitPer5Min, 'Rate limit per 5 minutes', 1),
      manufacturingOrderRateLimitPerHour: parseDraftPositiveInteger(values.rateLimitPerHour, 'Rate limit per hour', 1),
      manufacturingCreateOrderPostTitle: String(values.postTitle ?? '').trim(),
      manufacturingCreateOrderPostMessage: String(values.postMessage ?? '').trim(),
      manufacturingKeepaliveCronSchedule: cronExpression,
    };

    const forumChannel = await validateGuildChannel(interaction.guild, forumChannelId, 'Manufacturing forum channel ID');
    if (forumChannel.type !== ChannelType.GuildForum) {
      throw new Error('Manufacturing forum channel ID must point to a forum channel.');
    }

    const staffChannel = await validateGuildChannel(interaction.guild, staffChannelId, 'Manufacturing staff forum ID');
    if (staffChannel.type !== ChannelType.GuildForum) {
      throw new Error('Manufacturing staff forum ID must point to a forum channel.');
    }

    await validateGuildRole(interaction.guild, roleId, 'Manufacturing role ID');

    const updatedConfig = await upsertGuildConfig(interaction.guildId ?? '', patch);
    session.guildConfig = updatedConfig;
    rescheduleGuildKeepalive(interaction.client, updatedConfig.guildId, updatedConfig);
    await completeConfigurationFromMessage(
      interaction,
      sessionId,
      session,
      'manufacturing',
      'Manufacturing saved and keep-alive rescheduled. Run `/manufacturing setup` to refresh the Create Order thread if needed.',
    );
  } catch (error) {
    await interaction.editReply(
      buildScheduleErrorPrompt(
        sessionId,
        'manufacturing',
        session.draft,
        error instanceof Error ? error.message : 'Manufacturing could not be saved.',
      ),
    );
  }
}

async function savePurgeJobs(
  interaction: ButtonInteraction,
  sessionId: string,
  session: ConfigureSession,
): Promise<void> {
  if (!session.draft || session.draft.feature !== 'purge-jobs' || !session.draft.frequency || !session.draft.hour) {
    await interaction.update({
      content: 'Purge job settings are incomplete. Start the feature again with `/configure`.',
      components: [],
    });
    return;
  }

  try {
    await interaction.deferUpdate();
    const cronExpression = assertCronSupported(session.draft.frequency, session.draft.hour);
    const updatedConfig = await upsertGuildConfig(interaction.guildId ?? '', {
      purgeJobsEnabled: true,
      tempMemberHoursToExpire: parseDraftPositiveInteger(
        session.draft.values.tempMemberHoursToExpire,
        'Temporary member expiry hours',
        1,
        720,
      ),
      tempMemberPurgeCronSchedule: cronExpression,
    });
    session.guildConfig = updatedConfig;
    rescheduleGuildPurge(interaction.client, updatedConfig.guildId, updatedConfig);
    await completeConfigurationFromMessage(
      interaction,
      sessionId,
      session,
      'purge-jobs',
      'Purge jobs saved and rescheduled.',
    );
  } catch (error) {
    await interaction.editReply(
      buildScheduleErrorPrompt(
        sessionId,
        'purge-jobs',
        session.draft,
        error instanceof Error ? error.message : 'Purge jobs could not be saved.',
      ),
    );
  }
}

export async function handleConfigureButtonInteraction(interaction: ButtonInteraction): Promise<void> {
  const [prefix, sessionId, feature] = interaction.customId.split(':') as [string, string, ConfigureFeature];

  if (![CONFIGURE_OPEN_PREFIX, CONFIGURE_SKIP_PREFIX, CONFIGURE_SAVE_PREFIX, CONFIGURE_CONTINUE_PREFIX].includes(prefix)) {
    return;
  }

  const session = getCurrentSession(sessionId);
  if (!session) {
    await replySessionExpired(interaction);
    return;
  }

  if ((interaction.guildId ?? '') !== session.guildId) {
    await interaction.update({
      content: 'This configure session does not belong to this server. Run `/configure` again to restart.',
      components: [],
    });
    return;
  }

  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'This action requires Manage Server permission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const currentFeature = getCurrentFeature(session);
  if (!currentFeature || currentFeature !== feature) {
    await interaction.update({
      content: 'This configure step is no longer active. Run `/configure` again if you need to restart.',
      components: [],
    });
    return;
  }

  if (!isFeatureOperatorEnabled(feature)) {
    await interaction.update({
      content: buildContactOperatorMessage(feature),
      components: [],
    });
    return;
  }

  if (prefix === CONFIGURE_OPEN_PREFIX) {
    await openFeatureModal(interaction, sessionId, session);
    return;
  }

  if (prefix === CONFIGURE_CONTINUE_PREFIX) {
    await interaction.showModal(buildManufacturingAdvancedModal(sessionId, session.guildConfig));
    return;
  }

  if (prefix === CONFIGURE_SKIP_PREFIX) {
    session.results.push({ feature, status: 'skipped', detail: 'Skipped by administrator.' });
    session.index += 1;
    session.draft = null;

    const nextFeature = getCurrentFeature(session);
    if (nextFeature === null) {
      sessions.delete(sessionId);
      await interaction.update({
        content: buildWizardSummary(session),
        components: [],
      });
      return;
    }

    await interaction.update(buildFeaturePrompt(sessionId, nextFeature));
    return;
  }

  if (feature === 'nomination-digest') {
    await saveNominationDigest(interaction, sessionId, session);
    return;
  }

  if (feature === 'manufacturing') {
    await saveManufacturing(interaction, sessionId, session);
    return;
  }

  if (feature === 'purge-jobs') {
    await savePurgeJobs(interaction, sessionId, session);
    return;
  }

  await interaction.update({
    content: 'This configure step is not saveable from a button.',
    components: [],
  });
}

export async function handleConfigureSelectMenuInteraction(interaction: StringSelectMenuInteraction): Promise<void> {
  const [prefix, sessionId, feature] = interaction.customId.split(':') as [string, string, ConfigureFeature];

  if (![CONFIGURE_SELECT_FREQ_PREFIX, CONFIGURE_SELECT_HOUR_PREFIX].includes(prefix)) {
    return;
  }

  const session = getCurrentSession(sessionId);
  if (!session || !session.draft || session.draft.feature !== feature) {
    await replySessionExpired(interaction);
    return;
  }

  if ((interaction.guildId ?? '') !== session.guildId) {
    await interaction.update({
      content: 'This configure session does not belong to this server. Run `/configure` again to restart.',
      components: [],
    });
    return;
  }

  if (!interaction.inGuild() || !interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({
      content: 'This action requires Manage Server permission.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (prefix === CONFIGURE_SELECT_FREQ_PREFIX) {
      session.draft.frequency = parseScheduleFrequency(interaction.values[0]);
    } else {
      session.draft.hour = parseScheduleHour(interaction.values[0]);
    }
  } catch (error) {
    await interaction.update(
      buildScheduleErrorPrompt(
        sessionId,
        feature,
        session.draft,
        error instanceof Error ? error.message : 'Invalid schedule selection.',
      ),
    );
    return;
  }

  await interaction.update(buildSchedulePrompt(sessionId, feature, session.draft));
}
