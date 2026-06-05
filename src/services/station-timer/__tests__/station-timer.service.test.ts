import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function makeTimer(overrides: Record<string, unknown> = {}) {
  return {
    id: '0197182a-6d9e-7b58-8f43-4d5d3e808fd7',
    guildId: 'guild-1',
    discordUserId: 'user-1',
    userTimerId: 1,
    starterDisplayName: 'Pilot One',
    timerLabel: 'CZ',
    durationMinutes: 30,
    dueAt: '2026-05-29T00:30:00.000Z',
    dmSentAt: null,
    channelNotificationSentAt: null,
    status: 'active',
    createdAt: '2026-05-29T00:00:00.000Z',
    updatedAt: '2026-05-29T00:00:00.000Z',
    ...overrides,
  };
}

describe('listStationTimersForUser', () => {
  it('returns timers with remaining whole minutes rounded up', async () => {
    const listActiveStationTimersForUser = jest.fn(async () => [
      makeTimer({ dueAt: '2026-05-29T00:15:01.000Z' }),
    ]);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser,
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers: jest.fn(),
      completeStationTimer: jest.fn(),
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    const { listStationTimersForUser } = await import('../station-timer.service.js');
    const timers = await listStationTimersForUser('guild-1', 'user-1', new Date('2026-05-29T00:00:30.000Z'));

    expect(timers).toHaveLength(1);
    expect(timers[0].remainingMinutes).toBe(15);
  });
});

describe('processDueStationTimers', () => {
  it('claims due timers and completes them after DM-only processing', async () => {
    const claimDueStationTimers = jest.fn(async () => [makeTimer()]);
    const completeStationTimer = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');
    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map(),
      },
    };

    const processed = await processDueStationTimers(client as never, 10);

    expect(processed).toBe(1);
    expect(claimDueStationTimers).toHaveBeenCalledWith(10);
    expect(completeStationTimer).toHaveBeenCalledTimes(1);
  });

  it('sends a voice channel notification via voiceStates.fetch when member is in voice', async () => {
    const timer = makeTimer();
    const claimDueStationTimers = jest.fn(async () => [timer]);
    const completeStationTimer = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');

    const channelSend = jest.fn(async () => undefined);
    const voiceChannel = { send: channelSend };
    const member = { displayName: 'Pilot One' };
    const voiceStateFetch = jest.fn(async () => ({ channel: voiceChannel, member }));

    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map([
          ['guild-1', {
            voiceStates: { fetch: voiceStateFetch },
            preferredLocale: 'en',
          }],
        ]),
      },
    };

    await processDueStationTimers(client as never, 10);

    expect(voiceStateFetch).toHaveBeenCalledWith('user-1');
    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(completeStationTimer).toHaveBeenCalledTimes(1);
  });

  it('skips voice channel notification when member is not in a voice channel', async () => {
    const timer = makeTimer();
    const claimDueStationTimers = jest.fn(async () => [timer]);
    const completeStationTimer = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');

    const voiceStateFetch = jest.fn(async () => ({ channel: null, member: null }));

    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map([
          ['guild-1', {
            voiceStates: { fetch: voiceStateFetch },
            preferredLocale: 'en',
          }],
        ]),
      },
    };

    await processDueStationTimers(client as never, 10);

    expect(voiceStateFetch).toHaveBeenCalledWith('user-1');
    expect(completeStationTimer).toHaveBeenCalledWith(
      timer.id,
      expect.objectContaining({ channelNotificationSentAt: null }),
    );
  });

  it('uses guild.members.fetch for display name when voiceState.member is null', async () => {
    const timer = makeTimer();
    const claimDueStationTimers = jest.fn(async () => [timer]);
    const completeStationTimer = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');

    const channelSend = jest.fn(async () => undefined);
    const voiceChannel = { send: channelSend };
    const membersFetch = jest.fn(async () => ({ displayName: 'Fetched Name' }));
    // voiceState.member is null — triggers guild.members.fetch fallback
    const voiceStateFetch = jest.fn(async () => ({ channel: voiceChannel, member: null }));

    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map([
          ['guild-1', {
            voiceStates: { fetch: voiceStateFetch },
            members: { fetch: membersFetch },
            preferredLocale: 'en',
          }],
        ]),
      },
    };

    await processDueStationTimers(client as never, 10);

    expect(membersFetch).toHaveBeenCalledWith('user-1');
    expect(channelSend).toHaveBeenCalledTimes(1);
    expect(completeStationTimer).toHaveBeenCalledTimes(1);
  });

  it('falls back to starterDisplayName when voiceState.member is null and guild.members.fetch throws', async () => {
    const timer = makeTimer();
    const claimDueStationTimers = jest.fn(async () => [timer]);
    const completeStationTimer = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive: jest.fn(),
    }));

    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    const warn = jest.fn();
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn, error: jest.fn(), debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');

    const channelSend = jest.fn(async () => undefined);
    const voiceChannel = { send: channelSend };
    const membersFetch = jest.fn(async () => { throw new Error('REST error'); });
    const voiceStateFetch = jest.fn(async () => ({ channel: voiceChannel, member: null }));

    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map([
          ['guild-1', {
            voiceStates: { fetch: voiceStateFetch },
            members: { fetch: membersFetch },
            preferredLocale: 'en',
          }],
        ]),
      },
    };

    await processDueStationTimers(client as never, 10);

    // Notification still sent despite member fetch failure
    expect(channelSend).toHaveBeenCalledTimes(1);
    // Used starterDisplayName ('Pilot One') as fallback — not thrown/skipped
    expect(completeStationTimer).toHaveBeenCalledWith(
      timer.id,
      expect.objectContaining({ channelNotificationSentAt: expect.any(String) }),
    );
  });

  it('resets a delivering timer back to active when completion persistence fails', async () => {
    const claimDueStationTimers = jest.fn(async () => [makeTimer()]);
    const completeStationTimer = jest.fn(async () => {
      throw new Error('db write failed');
    });
    const resetStationTimerToActive = jest.fn(async () => undefined);

    jest.unstable_mockModule('../../../domain/station-timer/station-timer.repository.js', () => ({
      listActiveStationTimersForUser: jest.fn(),
      createStationTimer: jest.fn(),
      stopActiveStationTimerByUserSlot: jest.fn(),
      claimDueStationTimers,
      completeStationTimer,
      resetStationTimerToActive,
    }));

    const error = jest.fn();
    jest.unstable_mockModule('../../../config/station-timer.config.js', () => ({
      STATION_TIMER_DEFAULT_MINUTES: 30,
      stationTimerMaxActivePerGuild: () => 30,
      stationTimerMaxActivePerUser: () => 5,
    }));

    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ info: jest.fn(), warn: jest.fn(), error, debug: jest.fn() }),
    }));

    const { processDueStationTimers } = await import('../station-timer.service.js');
    const client = {
      users: {
        fetch: jest.fn(async () => ({ send: jest.fn(async () => undefined) })),
      },
      guilds: {
        cache: new Map(),
      },
    };

    const processed = await processDueStationTimers(client as never, 10);

    expect(processed).toBe(1);
    expect(completeStationTimer).toHaveBeenCalledTimes(1);
    expect(resetStationTimerToActive).toHaveBeenCalledWith(makeTimer().id);
    expect(error).toHaveBeenCalledWith(
      '[station-timer] Failed to persist completion after notifications',
      expect.objectContaining({ timerId: makeTimer().id, guildId: 'guild-1' }),
    );
  });
});
