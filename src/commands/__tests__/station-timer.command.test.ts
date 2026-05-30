import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

async function setup({
  enabled = true,
  databaseConfigured = true,
} = {}) {
  const startStationTimer = jest.fn<() => Promise<unknown>>();
  const listStationTimersForUser = jest.fn<() => Promise<unknown>>();
  const stopStationTimerForUser = jest.fn<() => Promise<unknown>>();

  jest.unstable_mockModule('../../config/station-timer.config.js', () => ({
    STATION_TIMER_DEFAULT_MINUTES: 30,
    isStationTimerEnabled: () => enabled,
  }));

  jest.unstable_mockModule('../../services/station-timer/station-timer.service.js', () => ({
    startStationTimer,
    listStationTimersForUser,
    stopStationTimerForUser,
    normalizeStationTimerMinutes: (value: number | null | undefined) => value ?? 30,
  }));

  jest.unstable_mockModule('../../services/nominations/db.js', () => ({
    isDatabaseConfigured: () => databaseConfigured,
  }));

  const mod = await import('../station-timer.command.js');
  return { ...mod, mocks: { startStationTimer, listStationTimersForUser, stopStationTimerForUser } };
}

function makeInteraction({
  action = null as string | null,
  type = null as string | null,
  time = null as number | null,
  id = null as number | null,
  inGuild = true,
} = {}) {
  return {
    guildId: 'guild-1',
    locale: 'en-US',
    user: { id: 'user-1', username: 'pilot-one' },
    member: { displayName: 'Pilot One' },
    inGuild: () => inGuild,
    options: {
      getString: jest.fn((key: string) => {
        if (key === 'action') return action;
        if (key === 'type') return type;
        return null;
      }),
      getInteger: jest.fn((key: string) => {
        if (key === 'time') return time;
        if (key === 'id') return id;
        return null;
      }),
    },
    reply: jest.fn(async () => undefined),
  };
}

describe('handleStationTimerCommand', () => {
  it('rejects use outside a guild', async () => {
    const { handleStationTimerCommand } = await setup();
    const interaction = makeInteraction({ inGuild: false });

    await handleStationTimerCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'This command can only be used in a server.',
    }));
  });

  it('returns disabled message when feature flag is off', async () => {
    const { handleStationTimerCommand } = await setup({ enabled: false });
    const interaction = makeInteraction();

    await handleStationTimerCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'Station timers are not enabled right now.',
    }));
  });

  it('starts a timer with defaults when no action/type/time are provided', async () => {
    const { handleStationTimerCommand, mocks } = await setup();
    mocks.startStationTimer.mockResolvedValue({
      ok: true,
      timer: {
        userTimerId: 2,
        durationMinutes: 30,
        timerLabel: 'CZ',
      },
    });
    const interaction = makeInteraction();

    await handleStationTimerCommand(interaction as never);

    expect(mocks.startStationTimer).toHaveBeenCalledWith(expect.objectContaining({
      timerLabel: 'CZ',
      durationMinutes: 30,
    }));
    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Timer ID: 2'),
    }));
  });

  it('lists active timers with remaining minutes', async () => {
    const { handleStationTimerCommand, mocks } = await setup();
    mocks.listStationTimersForUser.mockResolvedValue([
      {
        timer: {
          userTimerId: 1,
          durationMinutes: 30,
          timerLabel: 'CZ',
        },
        remainingMinutes: 12,
      },
    ]);
    const interaction = makeInteraction({ action: 'list' });

    await handleStationTimerCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('12 min remaining'),
    }));
  });

  it('requires an id for stop', async () => {
    const { handleStationTimerCommand } = await setup();
    const interaction = makeInteraction({ action: 'stop', id: null });

    await handleStationTimerCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'You must provide a timer ID when using `/station-timer action:stop`.',
    }));
  });

  it('returns not found when stop id does not belong to the user', async () => {
    const { handleStationTimerCommand, mocks } = await setup();
    mocks.stopStationTimerForUser.mockResolvedValue(null);
    const interaction = makeInteraction({ action: 'stop', id: 4 });

    await handleStationTimerCommand(interaction as never);

    expect(interaction.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: 'I could not find an active station timer with that ID for you in this server.',
    }));
  });
});
