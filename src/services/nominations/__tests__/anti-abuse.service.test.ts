import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

const DISABLED_POLICY = { userCooldownSeconds: 0, targetMaxPerDay: 0, userMaxPerDay: 0 };

describe('checkNominationAntiAbuse', () => {
  it('returns null when all checks are disabled', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(),
      countNominationsForTargetInWindow: jest.fn(),
      countNominationsByUserInWindow: jest.fn(),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    expect(await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', DISABLED_POLICY)).toBeNull();
  });

  it('returns null when user has never nominated (first nomination)', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userCooldownSeconds: 60,
    });
    expect(result).toBeNull();
  });

  it('returns cooldown violation when elapsed < cooldown', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => 30),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userCooldownSeconds: 60,
    });
    expect(result).toEqual({ kind: 'cooldown', secondsRemaining: 30 });
  });

  it('returns null when elapsed equals cooldown (boundary — not blocked)', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => 60),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userCooldownSeconds: 60,
    });
    expect(result).toBeNull();
  });

  it('returns null when elapsed exceeds cooldown', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => 90),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userCooldownSeconds: 60,
    });
    expect(result).toBeNull();
  });

  it('returns targetDailyLimit when target count >= cap', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 3),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'PilotNominee', {
      ...DISABLED_POLICY,
      targetMaxPerDay: 3,
    });
    expect(result).toEqual({ kind: 'targetDailyLimit', displayHandle: 'PilotNominee' });
  });

  it('returns null when target count is below cap', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 2),
      countNominationsByUserInWindow: jest.fn(async () => 0),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      targetMaxPerDay: 3,
    });
    expect(result).toBeNull();
  });

  it('returns userDailyLimit when user count >= cap', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 5),
      getSecondsUntilUserWindowResets: jest.fn(async () => 3600),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userMaxPerDay: 5,
    });
    expect(result).toEqual({ kind: 'userDailyLimit', secondsUntilReset: 3600 });
  });

  it('returns null when user count is below cap', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 4),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userMaxPerDay: 5,
    });
    expect(result).toBeNull();
  });

  it('cooldown check takes priority over target cap', async () => {
    const countNominationsForTargetInWindow = jest.fn(async () => 99);
    const countNominationsByUserInWindow = jest.fn(async () => 99);
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => 30),
      countNominationsForTargetInWindow,
      countNominationsByUserInWindow,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      userCooldownSeconds: 60,
      targetMaxPerDay: 1,
      userMaxPerDay: 1,
    });
    expect(result).toEqual({ kind: 'cooldown', secondsRemaining: 30 });
    expect(countNominationsForTargetInWindow).not.toHaveBeenCalled();
    expect(countNominationsByUserInWindow).not.toHaveBeenCalled();
  });

  it('returns null when reset time is 0 and re-check shows window has rolled over', async () => {
    let callCount = 0;
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => {
        callCount++;
        return callCount === 1 ? 5 : 4; // first call over cap, re-check under cap
      }),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userMaxPerDay: 5,
    });
    expect(result).toBeNull();
  });

  it('returns userDailyLimit when reset time is 0 but re-check still shows cap exceeded', async () => {
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow: jest.fn(async () => 0),
      countNominationsByUserInWindow: jest.fn(async () => 5),
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'Pilot', {
      ...DISABLED_POLICY,
      userMaxPerDay: 5,
    });
    expect(result).toEqual({ kind: 'userDailyLimit', secondsUntilReset: 0 });
  });

  it('target cap takes priority over user cap', async () => {
    const countNominationsForTargetInWindow = jest.fn(async () => 1);
    const countNominationsByUserInWindow = jest.fn(async () => 1);
    jest.unstable_mockModule('../nominations.repository.js', () => ({
      getSecondsSinceLastNominationByUser: jest.fn(async () => null),
      countNominationsForTargetInWindow,
      countNominationsByUserInWindow,
      getSecondsUntilUserWindowResets: jest.fn(async () => 0),
    }));

    const { checkNominationAntiAbuse } = await import('../anti-abuse.service.js');
    const result = await checkNominationAntiAbuse('u1', 'pilot', 'PilotNominee', {
      userCooldownSeconds: 0,
      targetMaxPerDay: 1,
      userMaxPerDay: 1,
    });
    expect(result).toEqual({ kind: 'targetDailyLimit', displayHandle: 'PilotNominee' });
    expect(countNominationsForTargetInWindow).toHaveBeenCalledTimes(1);
    expect(countNominationsByUserInWindow).toHaveBeenCalledTimes(1);
  });
});
