import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';
import type { GuildConfig } from '../../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
});

// Tear down module-level scheduler state between cases so tests cannot
// pick up tasks scheduled by a previous case. jest.resetModules() above
// already accomplishes this by re-instantiating the module, but the
// explicit reset documents the contract and lets us drop resetModules()
// in the future without breaking isolation silently.
afterEach(async () => {
  try {
    const mod = await import('../event-reminder.job.js');
    mod.resetEventRemindersForTests();
  } catch {
    // module not imported by the test — ignore.
  }
});

type CronCallback = () => Promise<void>;

const HOUR_MS = 60 * 60 * 1000;

function makeGuildConfig(overrides: Partial<GuildConfig> = {}): GuildConfig {
  return {
    guildId: 'guild-1',
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
    eventRemindersEnabled: true,
    eventRemindersDefaultChannelId: 'default-channel',
    eventRemindersCronSchedule: '*/15 * * * *',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockEvent {
  id: string;
  name: string;
  description: string | null;
  status: GuildScheduledEventStatus;
  entityType: GuildScheduledEventEntityType;
  channelId: string | null;
  scheduledStartTimestamp: number | null;
}

function makeEvent(overrides: Partial<MockEvent> = {}): MockEvent {
  return {
    id: 'event-1',
    name: 'Test Event',
    description: 'Body text',
    status: GuildScheduledEventStatus.Scheduled,
    entityType: GuildScheduledEventEntityType.External,
    channelId: null,
    scheduledStartTimestamp: Date.now() + 24 * HOUR_MS,
    ...overrides,
  };
}

interface MockSetup {
  capturedCallbacks: Map<string, CronCallback>;
  runTaskByIndex(i: number): Promise<void>;
  channelSend: jest.Mock;
  tryClaimReminder: jest.Mock;
  releaseReminderClaim: jest.Mock;
  getEventState: jest.Mock;
  upsertEventState: jest.Mock;
  warn: jest.Mock;
  error: jest.Mock;
  info: jest.Mock;
}

async function setupMocks(opts: {
  guildConfig?: GuildConfig | null;
  events?: MockEvent[];
  eventStateRows?: Record<string, { eventId: string; guildId: string; lastKnownStartTime: string }>;
  fetchEventsThrows?: boolean;
  fetchChannelReturns?: 'text' | 'non-text' | 'error' | 'null';
  sendThrows?: boolean;
  claimReturns?: boolean;
  voiceChannel?: { id: string; name: string };
  guildTextChannels?: ReadonlyArray<{ id: string; name: string }>;
  voiceChannelFetchThrows?: boolean;
  guildRoles?: ReadonlyArray<{ id: string; name: string }>;
} = {}): Promise<MockSetup> {
  const warn = jest.fn();
  const error = jest.fn();
  const info = jest.fn();

  const channelSend = jest.fn(async () => undefined);
  const sendableChannel = opts.fetchChannelReturns === 'non-text'
    ? { isTextBased: () => false }
    : { isTextBased: () => true, send: opts.sendThrows
        ? jest.fn(async () => { throw new Error('send failed'); })
        : channelSend };

  // When voice/text channel maps are provided, dispatch by id so the new
  // voice-event resolution path can fetch the voice channel by id and then
  // separately fetch the resolved text channel for posting. Otherwise fall
  // back to the single-channel behavior used by all pre-existing tests.
  const fetchChannel = (() => {
    if (opts.fetchChannelReturns === 'error') {
      return jest.fn(async () => { throw new Error('fetch failed'); });
    }
    if (opts.fetchChannelReturns === 'null') {
      return jest.fn(async () => null);
    }
    if (opts.voiceChannel || opts.guildTextChannels) {
      const voice = opts.voiceChannel;
      const textById = new Map(
        (opts.guildTextChannels ?? []).map((channel) => [channel.id, { ...channel, ...sendableChannel }]),
      );
      return jest.fn(async (channelId: string) => {
        if (voice && channelId === voice.id) {
          if (opts.voiceChannelFetchThrows) throw new Error('voice fetch failed');
          return { id: voice.id, name: voice.name };
        }
        return textById.get(channelId) ?? sendableChannel;
      });
    }
    return jest.fn(async () => sendableChannel);
  })();

  const tryClaimReminder = jest.fn(async () => opts.claimReturns ?? true);
  const releaseReminderClaim = jest.fn(async () => undefined);
  const getEventState = jest.fn(async (eventId: string) =>
    opts.eventStateRows?.[eventId] ?? null,
  );
  const upsertEventState = jest.fn(async () => undefined);

  const capturedCallbacks = new Map<string, CronCallback>();
  let scheduleCallCount = 0;

  jest.unstable_mockModule('../../../utils/logger.js', () => ({
    getLogger: () => ({ warn, error, info, debug: jest.fn() }),
  }));

  jest.unstable_mockModule('../../../services/event-reminders/event-reminders.repository.js', () => ({
    tryClaimReminder,
    releaseReminderClaim,
    getEventState,
    upsertEventState,
  }));

  jest.unstable_mockModule('../../../domain/guild-config/guild-config.service.js', () => ({
    getGuildConfigOrNull: jest.fn(async () =>
      opts.guildConfig === undefined ? makeGuildConfig() : opts.guildConfig,
    ),
    getAllGuildConfigs: jest.fn(),
  }));

  const events = opts.events ?? [];
  const eventsMap = new Map(events.map((e) => [e.id, e]));
  const scheduledEvents = {
    fetch: opts.fetchEventsThrows
      ? jest.fn(async () => { throw new Error('events fetch failed'); })
      : jest.fn(async () => eventsMap),
  };

  jest.unstable_mockModule('node-cron', () => ({
    default: {
      validate: jest.fn(() => true),
      schedule: jest.fn((_schedule: string, cb: CronCallback) => {
        const key = `task-${scheduleCallCount++}`;
        capturedCallbacks.set(key, cb);
        return { stop: jest.fn(), _key: key };
      }),
    },
  }));

  jest.unstable_mockModule('../../../utils/i18n-config.js', () => ({
    default: { __mf: (params: { phrase: string }, vars: Record<string, unknown>) =>
      `[${params.phrase}] ${JSON.stringify(vars)}`,
    },
  }));

  // ChannelType.GuildText === 0 per discord.js. Hardcode here to avoid
  // pulling in the runtime enum just for a test fixture.
  const GUILD_TEXT = 0;
  const guildChannelsCache = new Map(
    (opts.guildTextChannels ?? []).map((channel) => [
      channel.id,
      { id: channel.id, name: channel.name, type: GUILD_TEXT },
    ]),
  );

  const guildRolesCache = new Map(
    (opts.guildRoles ?? []).map((role) => [role.id, { id: role.id, name: role.name }]),
  );

  // We need a client whose `guilds.cache.get` returns a mock guild that holds
  // the scheduledEvents mock and a `client.channels.fetch` for posting.
  const client = {
    guilds: {
      cache: new Map([
        ['guild-1', {
          id: 'guild-1',
          preferredLocale: 'en-US',
          scheduledEvents,
          channels: { cache: guildChannelsCache },
          roles: { cache: guildRolesCache },
          get client() { return client; },
        }],
      ]),
    },
    channels: { fetch: fetchChannel },
  };

  return {
    capturedCallbacks,
    runTaskByIndex: async (i: number) => {
      const cb = capturedCallbacks.get(`task-${i}`);
      if (!cb) throw new Error(`No callback for task-${i}`);
      await cb();
    },
    channelSend,
    tryClaimReminder,
    releaseReminderClaim,
    getEventState,
    upsertEventState,
    warn,
    error,
    info,
    // Hand the test the client so it can call scheduleEventReminders.
    ...({ _client: client } as Record<string, unknown>),
  } as MockSetup & { _client: unknown };
}

async function importJob() {
  return import('../event-reminder.job.js');
}

// ---------------------------------------------------------------------------
// scheduleEventReminders — registration
// ---------------------------------------------------------------------------

describe('scheduleEventReminders', () => {
  it('creates one task per guild with event reminders enabled', async () => {
    const setup = await setupMocks();
    const { scheduleEventReminders } = await importJob();
    const cronMod = await import('node-cron');

    const tasks = scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [
        makeGuildConfig({ guildId: 'guild-1' }),
        makeGuildConfig({ guildId: 'guild-2' }),
      ],
    );

    expect(tasks.size).toBe(2);
    expect((cronMod.default.schedule as jest.Mock)).toHaveBeenCalledTimes(2);
  });

  it('skips a guild with eventRemindersEnabled=false', async () => {
    await setupMocks();
    const { scheduleEventReminders } = await importJob();
    const cronMod = await import('node-cron');

    const tasks = scheduleEventReminders(
      {} as never,
      [makeGuildConfig({ eventRemindersEnabled: false })],
    );

    expect(tasks.size).toBe(0);
    expect((cronMod.default.schedule as jest.Mock)).not.toHaveBeenCalled();
  });

  it('logs error and skips a guild with an invalid cron schedule', async () => {
    const setup = await setupMocks();
    const { scheduleEventReminders } = await importJob();
    const cronMod = await import('node-cron');
    (cronMod.default.validate as jest.Mock).mockReturnValueOnce(false);

    const tasks = scheduleEventReminders(
      {} as never,
      [makeGuildConfig({ eventRemindersCronSchedule: 'not-valid' })],
    );

    expect(tasks.size).toBe(0);
    expect(setup.error).toHaveBeenCalledWith(
      expect.stringContaining('Invalid cron schedule'),
      expect.any(Object),
    );
  });

  it('stops existing tasks when re-scheduled with the same guild', async () => {
    const setup = await setupMocks();
    const { scheduleEventReminders } = await importJob();

    const first = scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig({ guildId: 'guild-1' })],
    );
    const firstTask = first.get('guild-1') as unknown as { stop: jest.Mock };

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig({ guildId: 'guild-1' })],
    );

    expect(firstTask.stop).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// tick logic — 24h and 6h reminder windows
// ---------------------------------------------------------------------------

describe('event reminder tick', () => {
  it('sends a 24h reminder when an event is exactly 24h away', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'default-channel');
    expect(setup.channelSend).toHaveBeenCalled();
    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as { content: string; allowedMentions: unknown };
    expect(sendCall.content).toContain('[jobs.eventReminders.message]');
    expect(sendCall.allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('sends a 6h reminder when an event is exactly 6h away', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 6 * HOUR_MS });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '6h', 'default-channel');
    expect(setup.channelSend).toHaveBeenCalled();
  });

  it('does not send a reminder when the event is well outside any window', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 12 * HOUR_MS });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.channelSend).not.toHaveBeenCalled();
  });

  it('does not send when claim returns false (already-sent dedup)', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event], claimReturns: false });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalled();
    expect(setup.channelSend).not.toHaveBeenCalled();
  });

  it('releases the claim when the channel send throws', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event], sendThrows: true });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalled();
    expect(setup.releaseReminderClaim).toHaveBeenCalledWith('event-1', '24h');
  });

  it('formats startTime as a Discord <t:UNIX:F> token', async () => {
    const now = Date.now();
    const startMs = now + 24 * HOUR_MS;
    const event = makeEvent({ scheduledStartTimestamp: startMs });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as { content: string };
    const expectedUnix = Math.floor(startMs / 1000);
    expect(sendCall.content).toContain(`<t:${expectedUnix}:F>`);
    expect(sendCall.content).toContain(`<t:${expectedUnix}:R>`);
  });

  it('includes the Discord event link', async () => {
    const now = Date.now();
    const event = makeEvent({ id: 'event-xyz', scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as { content: string };
    expect(sendCall.content).toContain('https://discord.com/events/guild-1/event-xyz');
  });

  it('truncates the body so the message fits Discord 2000-char limit while preserving the event link', async () => {
    const now = Date.now();
    const event = makeEvent({
      id: 'event-truncate',
      description: 'x'.repeat(3000),
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as { content: string };
    expect(sendCall.content.length).toBeLessThanOrEqual(2000);
    // Body was truncated — ellipsis present somewhere in the message
    expect(sendCall.content).toContain('…');
    // Event link survived truncation (required for Discord's event-card embed)
    expect(sendCall.content).toContain('https://discord.com/events/guild-1/event-truncate');
  });
});

describe('claim/release ordering', () => {
  it('does not claim a reminder when the channel cannot be fetched', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event], fetchChannelReturns: 'error' });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    // The fix: the claim must NOT happen for an unreachable channel,
    // otherwise we'd insert+delete a row on every tick.
    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.releaseReminderClaim).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch reminder channel'),
      expect.any(Object),
    );
  });

  it('does not claim a reminder when the channel is not text-based', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 24 * HOUR_MS });
    const setup = await setupMocks({ events: [event], fetchChannelReturns: 'non-text' });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.releaseReminderClaim).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// channel routing — voice/stage events resolve to a regular text channel by
// guild-wide naming convention (first token of voice channel name + `-` +
// containing `general`). External events use the configured default channel.
// ---------------------------------------------------------------------------

describe('channel routing — voice/stage by name convention', () => {
  it('Voice events resolve to the matching {prefix}-...-general text channel', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Salvage Voice' },
      guildTextChannels: [
        { id: 'text-memos', name: 'salvage-memos' },
        { id: 'text-ops', name: 'salvage-ops' },
        { id: 'text-general', name: 'salvage-general-chat' },
        { id: 'text-mining', name: 'mining-general-chat' },
      ],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'text-general');
  });

  it('StageInstance events resolve by the same naming convention', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.StageInstance,
      channelId: 'stage-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'stage-id', name: 'ORG Stage Voice' },
      guildTextChannels: [
        { id: 'text-org-general', name: 'org-general-chat' },
        { id: 'text-org-media', name: 'org-media' },
      ],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'text-org-general');
  });

  it('ignores non-GuildText channels in the cache (no leakage into voice-attached text chat)', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    // Simulate a guild cache that also contains the voice channel itself
    // (which discord.js exposes alongside GuildText channels). The voice
    // channel's in-voice text chat surface MUST NOT be selectable as a
    // reminder destination, even if its name happens to match the prefix.
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Salvage Voice' },
      guildTextChannels: [
        { id: 'text-general', name: 'salvage-general-chat' },
      ],
    });
    // Manually inject a non-text channel sharing the prefix into the guild's
    // channels.cache to assert the filter excludes it.
    const guild = (setup as unknown as { _client: { guilds: { cache: Map<string, { channels: { cache: Map<string, { id: string; name: string; type: number }> } }> } } })._client.guilds.cache.get('guild-1');
    const GUILD_VOICE = 2;
    guild!.channels.cache.set('voice-id', { id: 'voice-id', name: 'salvage-voice', type: GUILD_VOICE });

    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'text-general');
  });

  it('External events post to the configured default channel', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.External,
      channelId: null,
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'default-channel');
  });

  it('Voice events skip with a warning when zero text channels match the prefix', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Mining Voice' },
      guildTextChannels: [
        { id: 'text-salvage', name: 'salvage-general-chat' },
      ],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve text channel'),
      expect.objectContaining({ reason: 'no-match' }),
    );
  });

  it('Voice events skip with a warning when multiple text channels match (ambiguous)', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Salvage Voice' },
      guildTextChannels: [
        { id: 'text-a', name: 'salvage-general' },
        { id: 'text-b', name: 'salvage-general-chat' },
      ],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not resolve text channel'),
      expect.objectContaining({ reason: 'ambiguous' }),
    );
  });

  it('Voice events with no channelId skip with a warning (no fallback to default)', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: null,
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Voice/stage event has no voice channel set'),
      expect.any(Object),
    );
  });

  it('Voice events skip with a warning when the voice channel fetch fails', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Salvage Voice' },
      voiceChannelFetchThrows: true,
      guildTextChannels: [{ id: 'text-general', name: 'salvage-general-chat' }],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch voice channel'),
      expect.any(Object),
    );
  });

  it('External events skip with a warning when no default channel is configured', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.External,
      channelId: null,
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      guildConfig: makeGuildConfig({ eventRemindersDefaultChannelId: null }),
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('no channel available'),
      expect.any(Object),
    );
  });
});

// ---------------------------------------------------------------------------
// matchTextChannelByVoiceName — pure unit tests for the resolution rule
// ---------------------------------------------------------------------------

describe('matchTextChannelByVoiceName', () => {
  it('matches the single text channel starting with {prefix}- and containing general', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('Salvage Voice', [
      { id: 'a', name: 'salvage-memos' },
      { id: 'b', name: 'salvage-general-chat' },
      { id: 'c', name: 'salvage-ops' },
    ]);
    expect(result).toEqual({ channelId: 'b' });
  });

  it('is case-insensitive on both the voice name and the text channel names', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('SC Game Voice #1', [
      { id: 'a', name: 'SC-General' },
    ]);
    expect(result).toEqual({ channelId: 'a' });
  });

  it('returns no-match when no text channel starts with the prefix', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('Mining Voice', [
      { id: 'a', name: 'salvage-general-chat' },
    ]);
    expect(result).toEqual({ error: 'no-match', candidateIds: [] });
  });

  it('returns no-match when the prefix matches but no channel contains "general"', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('Salvage Voice', [
      { id: 'a', name: 'salvage-memos' },
      { id: 'b', name: 'salvage-ops' },
    ]);
    expect(result).toEqual({ error: 'no-match', candidateIds: [] });
  });

  it('returns ambiguous when multiple channels match', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('Salvage Voice', [
      { id: 'a', name: 'salvage-general' },
      { id: 'b', name: 'salvage-general-chat' },
    ]);
    expect(result).toEqual({ error: 'ambiguous', candidateIds: ['a', 'b'] });
  });

  it('returns no-match for an empty voice channel name', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    const result = matchTextChannelByVoiceName('   ', [
      { id: 'a', name: 'salvage-general-chat' },
    ]);
    expect(result).toEqual({ error: 'no-match', candidateIds: [] });
  });

  it('requires the prefix to be followed by a hyphen (not just any character)', async () => {
    const { matchTextChannelByVoiceName } = await importJob();
    // 'salvager-general-chat' should NOT match prefix 'salvage' because the
    // boundary is `-`, not arbitrary continuation.
    const result = matchTextChannelByVoiceName('Salvage Voice', [
      { id: 'a', name: 'salvager-general-chat' },
    ]);
    expect(result).toEqual({ error: 'no-match', candidateIds: [] });
  });
});

// ---------------------------------------------------------------------------
// reschedule notice (Edge Case #2)
// ---------------------------------------------------------------------------

describe('reschedule notice', () => {
  it('does not send a notice for an event seen for the first time', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 36 * HOUR_MS });
    const setup = await setupMocks({ events: [event], eventStateRows: {} });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.upsertEventState).toHaveBeenCalled();
    expect(setup.channelSend).not.toHaveBeenCalled();
  });

  it('sends a reschedule notice when start time changes and new start is inside the reschedule window', async () => {
    // Important: setupMocks() must run before importJob() so the mocked
    // node-cron is registered before the module evaluates.
    // We compute boundary values from the production constant after the
    // first import so tests pin to the same window as the running code.
    const now = Date.now();
    // Placeholder times — recomputed once we know the actual window.
    const event = makeEvent({ scheduledStartTimestamp: now + 12 * HOUR_MS });
    const setup = await setupMocks({
      events: [event],
      eventStateRows: {
        'event-1': { eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: new Date(now).toISOString() },
      },
    });
    const job = await importJob();
    const { scheduleEventReminders, RESCHEDULE_NOTICE_WINDOW_MS } = job;
    const oldStart = new Date(now + RESCHEDULE_NOTICE_WINDOW_MS + 12 * HOUR_MS).toISOString();
    const newStartMs = now + Math.floor(RESCHEDULE_NOTICE_WINDOW_MS / 2);
    event.scheduledStartTimestamp = newStartMs;
    (setup.getEventState as jest.Mock<() => Promise<unknown>>).mockResolvedValueOnce({ eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: oldStart });

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    const rescheduleKey = `reschedule-${Math.floor(newStartMs / 1000)}`;
    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', rescheduleKey, 'default-channel');
    const sentReschedule = setup.channelSend.mock.calls.find((call) => {
      const content = ((call as unknown[])[0] as { content: string }).content;
      return content.includes('messageRescheduled');
    });
    expect(sentReschedule).toBeDefined();
  });

  it('updates state but does not send a notice when reschedule moves the event beyond the reschedule window', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now + 12 * HOUR_MS });
    const setup = await setupMocks({
      events: [event],
      eventStateRows: {
        'event-1': { eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: new Date(now).toISOString() },
      },
    });
    const job = await importJob();
    const { scheduleEventReminders, RESCHEDULE_NOTICE_WINDOW_MS } = job;
    const oldStart = new Date(now + RESCHEDULE_NOTICE_WINDOW_MS + 12 * HOUR_MS).toISOString();
    const newStartMs = now + Math.floor(RESCHEDULE_NOTICE_WINDOW_MS * 1.5);
    event.scheduledStartTimestamp = newStartMs;
    (setup.getEventState as jest.Mock<() => Promise<unknown>>).mockResolvedValueOnce({ eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: oldStart });

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.upsertEventState).toHaveBeenCalled();
    const rescheduleCalls = setup.channelSend.mock.calls.filter((call) => {
      const content = ((call as unknown[])[0] as { content: string }).content;
      return content.includes('messageRescheduled');
    });
    expect(rescheduleCalls).toHaveLength(0);
  });

  it('does not send a reschedule notice when the start time is unchanged', async () => {
    const now = Date.now();
    const startMs = now + 36 * HOUR_MS;
    const event = makeEvent({ scheduledStartTimestamp: startMs });
    const setup = await setupMocks({
      events: [event],
      eventStateRows: {
        'event-1': { eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: new Date(startMs).toISOString() },
      },
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    const rescheduleCalls = setup.channelSend.mock.calls.filter((call) => {
      const content = ((call as unknown[])[0] as { content: string }).content;
      return content.includes('messageRescheduled');
    });
    expect(rescheduleCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// skip paths — disabled config, missing config, fetch failures, past events
// ---------------------------------------------------------------------------

describe('skip paths', () => {
  it('warns and skips when guild config is null at tick time', async () => {
    const setup = await setupMocks({ guildConfig: null, events: [] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('unavailable or missing'),
      expect.any(Object),
    );
    expect(setup.channelSend).not.toHaveBeenCalled();
  });

  it('warns and skips when eventRemindersEnabled is false at tick time', async () => {
    const setup = await setupMocks({
      guildConfig: makeGuildConfig({ eventRemindersEnabled: false }),
      events: [],
    });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('disabled in guild config at tick time'),
      expect.any(Object),
    );
  });

  it('warns and does not throw when fetching scheduled events fails', async () => {
    const setup = await setupMocks({ fetchEventsThrows: true });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await expect(setup.runTaskByIndex(0)).resolves.not.toThrow();

    expect(setup.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to fetch scheduled events'),
      expect.any(Object),
    );
  });

  it('skips events whose start time has already passed', async () => {
    const now = Date.now();
    const event = makeEvent({ scheduledStartTimestamp: now - HOUR_MS });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.channelSend).not.toHaveBeenCalled();
  });

  it('skips events with status Completed or Canceled', async () => {
    const now = Date.now();
    const events = [
      makeEvent({
        id: 'event-completed',
        status: GuildScheduledEventStatus.Completed,
        scheduledStartTimestamp: now + 24 * HOUR_MS,
      }),
      makeEvent({
        id: 'event-canceled',
        status: GuildScheduledEventStatus.Canceled,
        scheduledStartTimestamp: now + 24 * HOUR_MS,
      }),
    ];
    const setup = await setupMocks({ events });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).not.toHaveBeenCalled();
    expect(setup.channelSend).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// resolveMentionForVoiceToken — pure unit tests for the tier mention rule
// ---------------------------------------------------------------------------

describe('resolveMentionForVoiceToken', () => {
  it('returns @everyone for the public token (sc)', async () => {
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('sc', 'role-org', [
      { id: 'role-salvage', name: 'Salvage' },
    ]);
    expect(result).toEqual({ mention: '@everyone', allowedMentions: { parse: ['everyone'] } });
  });

  it('returns the configured org member role mention for the org token', async () => {
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('org', 'role-org-123', []);
    expect(result).toEqual({
      mention: '<@&role-org-123>',
      allowedMentions: { parse: [], roles: ['role-org-123'] },
    });
  });

  it('returns @here for the org token when no org member role is configured', async () => {
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('org', null, []);
    expect(result).toEqual({ mention: '@here', allowedMentions: { parse: ['everyone'] } });
  });

  it('returns the matching role mention for a division token (case-insensitive)', async () => {
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('salvage', null, [
      { id: 'role-mining', name: 'Mining' },
      { id: 'role-salvage', name: 'Salvage' },
    ]);
    expect(result).toEqual({
      mention: '<@&role-salvage>',
      allowedMentions: { parse: [], roles: ['role-salvage'] },
    });
  });

  it('returns @here when a division token has no matching role', async () => {
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('engineering', null, [
      { id: 'role-mining', name: 'Mining' },
    ]);
    expect(result).toEqual({ mention: '@here', allowedMentions: { parse: ['everyone'] } });
  });

  it('matches the role by first token only — multi-word voice names still resolve to single-token roles', async () => {
    // 'Logistics Corps Voice' → first token 'logistics' → looks for a role
    // named 'Logistics' (case-insensitive equality on the token, not on the
    // full voice channel name).
    const { resolveMentionForVoiceToken } = await importJob();
    const result = resolveMentionForVoiceToken('logistics', null, [
      { id: 'role-logistics', name: 'Logistics' },
    ]);
    expect(result).toEqual({
      mention: '<@&role-logistics>',
      allowedMentions: { parse: [], roles: ['role-logistics'] },
    });
  });
});

// ---------------------------------------------------------------------------
// end-to-end mention routing — events posted to the right channel ping the
// right audience based on the voice channel's first token.
// ---------------------------------------------------------------------------

describe('tier mention routing', () => {
  it('Public-tier voice event (sc) pings @everyone', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'SC Game Voice #1' },
      guildTextChannels: [{ id: 'text-sc-general', name: 'sc-general' }],
    });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('@everyone');
    expect(sendCall.allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('Org-tier voice event (org) pings the configured org member role', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'ORG Game Voice #1' },
      guildTextChannels: [{ id: 'text-org-general', name: 'org-general-chat' }],
      guildConfig: makeGuildConfig({ orgMemberRoleId: 'role-org-123' }),
    });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('<@&role-org-123>');
    expect(sendCall.allowedMentions).toEqual({ parse: [], roles: ['role-org-123'] });
  });

  it('Org-tier voice event with no orgMemberRoleId configured falls back to @here', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'ORG Game Voice #1' },
      guildTextChannels: [{ id: 'text-org-general', name: 'org-general-chat' }],
      guildConfig: makeGuildConfig({ orgMemberRoleId: null }),
    });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('@here');
    expect(sendCall.allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('Division voice event pings the matching role (case-insensitive name)', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Salvage Voice' },
      guildTextChannels: [{ id: 'text-salvage-general', name: 'salvage-general-chat' }],
      guildRoles: [
        { id: 'role-mining', name: 'Mining' },
        { id: 'role-salvage', name: 'Salvage' },
      ],
    });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('<@&role-salvage>');
    expect(sendCall.allowedMentions).toEqual({ parse: [], roles: ['role-salvage'] });
  });

  it('Division voice event with no matching role falls back to @here', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({
      events: [event],
      voiceChannel: { id: 'voice-id', name: 'Engineering Voice' },
      guildTextChannels: [{ id: 'text-eng-general', name: 'engineering-general-chat' }],
      guildRoles: [{ id: 'role-mining', name: 'Mining' }],
    });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('@here');
    expect(sendCall.allowedMentions).toEqual({ parse: ['everyone'] });
  });

  it('External events ping @everyone in the configured default channel', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.External,
      channelId: null,
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();
    scheduleEventReminders((setup as unknown as { _client: never })._client, [makeGuildConfig()]);
    await setup.runTaskByIndex(0);

    const sendCall = (setup.channelSend.mock.calls[0] as unknown[])[0] as {
      content: string;
      allowedMentions: unknown;
    };
    expect(sendCall.content).toContain('@everyone');
    expect(sendCall.allowedMentions).toEqual({ parse: ['everyone'] });
  });
});
