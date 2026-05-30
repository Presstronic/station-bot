import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

const NOW = '2026-05-29T00:00:00.000Z';

function makeTimerRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '0197182a-6d9e-7b58-8f43-4d5d3e808fd7',
    guild_id: 'guild-1',
    discord_user_id: 'user-1',
    user_timer_id: 1,
    starter_display_name: 'Pilot One',
    timer_label: 'CZ',
    duration_minutes: 30,
    due_at: NOW,
    dm_sent_at: null,
    channel_notification_sent_at: null,
    status: 'active',
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

function makeWithClient(querySpy: jest.Mock) {
  return jest.fn(async (fn: (client: { query: jest.Mock }) => Promise<unknown>) => fn({ query: querySpy }));
}

describe('createStationTimer', () => {
  it('returns user-cap when the user already has the max active timers', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ active_count: 5 }] })
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { createStationTimer } = await import('../station-timer.repository.js');
    const result = await createStationTimer({
      id: '0197182a-6d9e-7b58-8f43-4d5d3e808fd7',
      guildId: 'guild-1',
      discordUserId: 'user-1',
      starterDisplayName: 'Pilot One',
      timerLabel: 'CZ',
      durationMinutes: 30,
      dueAt: NOW,
      maxActivePerGuild: 30,
      maxActivePerUser: 5,
    });

    expect(result).toEqual({ ok: false, reason: 'user-cap' });
  });

  it('returns guild-cap when the guild is already full', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ active_count: 2 }] })
      .mockResolvedValueOnce({ rows: [{ active_count: 30 }] })
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { createStationTimer } = await import('../station-timer.repository.js');
    const result = await createStationTimer({
      id: '0197182a-6d9e-7b58-8f43-4d5d3e808fd7',
      guildId: 'guild-1',
      discordUserId: 'user-1',
      starterDisplayName: 'Pilot One',
      timerLabel: 'CZ',
      durationMinutes: 30,
      dueAt: NOW,
      maxActivePerGuild: 30,
      maxActivePerUser: 5,
    });

    expect(result).toEqual({ ok: false, reason: 'guild-cap' });
  });

  it('allocates the lowest free slot and inserts a timer row', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ active_count: 1 }] })
      .mockResolvedValueOnce({ rows: [{ active_count: 4 }] })
      .mockResolvedValueOnce({ rows: [{ slot: 2 }] })
      .mockResolvedValueOnce({ rows: [makeTimerRow({ user_timer_id: 2 })] })
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { createStationTimer } = await import('../station-timer.repository.js');
    const result = await createStationTimer({
      id: '0197182a-6d9e-7b58-8f43-4d5d3e808fd7',
      guildId: 'guild-1',
      discordUserId: 'user-1',
      starterDisplayName: 'Pilot One',
      timerLabel: 'CZ',
      durationMinutes: 30,
      dueAt: NOW,
      maxActivePerGuild: 30,
      maxActivePerUser: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.timer.userTimerId).toBe(2);
      expect(result.timer.timerLabel).toBe('CZ');
    }
  });
});

describe('listActiveStationTimersForUser', () => {
  it('maps active timers ordered by slot', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [makeTimerRow({ user_timer_id: 1 }), makeTimerRow({ user_timer_id: 2 })] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { listActiveStationTimersForUser } = await import('../station-timer.repository.js');
    const timers = await listActiveStationTimersForUser('guild-1', 'user-1');

    expect(timers).toHaveLength(2);
    expect(timers[0].userTimerId).toBe(1);
    expect(timers[1].userTimerId).toBe(2);
  });
});

describe('stopActiveStationTimerByUserSlot', () => {
  it('returns null when no matching active timer exists', async () => {
    const query = jest
      .fn<() => Promise<{ rows: unknown[] }>>()
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    jest.unstable_mockModule('../../../services/nominations/db.js', () => ({
      isDatabaseConfigured: () => true,
      withClient: makeWithClient(query),
    }));

    const { stopActiveStationTimerByUserSlot } = await import('../station-timer.repository.js');
    expect(await stopActiveStationTimerByUserSlot('guild-1', 'user-1', 3)).toBeNull();
  });
});
