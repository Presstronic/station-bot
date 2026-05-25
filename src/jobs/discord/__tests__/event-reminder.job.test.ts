import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { GuildScheduledEventEntityType, GuildScheduledEventStatus } from 'discord.js';
import type { GuildConfig } from '../../../domain/guild-config/guild-config.service.js';

beforeEach(() => {
  jest.resetModules();
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
} = {}): Promise<MockSetup> {
  const warn = jest.fn();
  const error = jest.fn();
  const info = jest.fn();

  const channelSend = jest.fn(async () => undefined);
  const channel = opts.fetchChannelReturns === 'non-text'
    ? { isTextBased: () => false }
    : { isTextBased: () => true, send: opts.sendThrows
        ? jest.fn(async () => { throw new Error('send failed'); })
        : channelSend };

  const fetchChannel = opts.fetchChannelReturns === 'error'
    ? jest.fn(async () => { throw new Error('fetch failed'); })
    : opts.fetchChannelReturns === 'null'
      ? jest.fn(async () => null)
      : jest.fn(async () => channel);

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

  jest.unstable_mockModule('i18n', () => ({
    default: { __mf: (params: { phrase: string }, vars: Record<string, unknown>) =>
      `[${params.phrase}] ${JSON.stringify(vars)}`,
    },
  }));

  // We need a client whose `guilds.cache.get` returns a mock guild that holds
  // the scheduledEvents mock and a `client.channels.fetch` for posting.
  const client = {
    guilds: {
      cache: new Map([
        ['guild-1', {
          id: 'guild-1',
          preferredLocale: 'en-US',
          scheduledEvents,
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
    expect(sendCall.content).toContain('[jobs.eventReminders.message24h]');
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
});

// ---------------------------------------------------------------------------
// channel routing — Voice vs External
// ---------------------------------------------------------------------------

describe('channel routing', () => {
  it('Voice events post to event.channelId', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.Voice,
      channelId: 'voice-channel-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'voice-channel-id');
  });

  it('StageInstance events post to event.channelId', async () => {
    const now = Date.now();
    const event = makeEvent({
      entityType: GuildScheduledEventEntityType.StageInstance,
      channelId: 'stage-channel-id',
      scheduledStartTimestamp: now + 24 * HOUR_MS,
    });
    const setup = await setupMocks({ events: [event] });
    const { scheduleEventReminders } = await importJob();

    scheduleEventReminders(
      (setup as unknown as { _client: never })._client,
      [makeGuildConfig()],
    );
    await setup.runTaskByIndex(0);

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'stage-channel-id');
  });

  it('External events post to default channel', async () => {
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

  it('Voice events with no channelId fall back to default channel', async () => {
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

    expect(setup.tryClaimReminder).toHaveBeenCalledWith('guild-1', 'event-1', '24h', 'default-channel');
  });

  it('warns and does not claim when no channel can be resolved', async () => {
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

  it('sends a reschedule notice when start time changes and new start is within 48h', async () => {
    const now = Date.now();
    const oldStart = new Date(now + 60 * HOUR_MS).toISOString();
    const newStartMs = now + 30 * HOUR_MS;
    const event = makeEvent({ scheduledStartTimestamp: newStartMs });
    const setup = await setupMocks({
      events: [event],
      eventStateRows: {
        'event-1': { eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: oldStart },
      },
    });
    const { scheduleEventReminders } = await importJob();

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

  it('updates state but does not send a notice when reschedule moves the event >48h out', async () => {
    const now = Date.now();
    const oldStart = new Date(now + 60 * HOUR_MS).toISOString();
    const newStartMs = now + 72 * HOUR_MS;
    const event = makeEvent({ scheduledStartTimestamp: newStartMs });
    const setup = await setupMocks({
      events: [event],
      eventStateRows: {
        'event-1': { eventId: 'event-1', guildId: 'guild-1', lastKnownStartTime: oldStart },
      },
    });
    const { scheduleEventReminders } = await importJob();

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
