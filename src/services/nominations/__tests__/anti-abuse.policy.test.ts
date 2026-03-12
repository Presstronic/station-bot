import { beforeEach, describe, expect, it, jest } from '@jest/globals';

describe('getNominationRatePolicy', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.NOMINATION_USER_COOLDOWN_SECONDS;
    delete process.env.NOMINATION_TARGET_MAX_PER_DAY;
    delete process.env.NOMINATION_USER_MAX_PER_DAY;
  });

  async function getPolicy() {
    const { getNominationRatePolicy } = await import('../anti-abuse.policy.ts');
    return getNominationRatePolicy();
  }

  it('returns defaults when no env vars are set', async () => {
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 60,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });

  it('parses explicit valid values', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = '30';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = '5';
    process.env.NOMINATION_USER_MAX_PER_DAY = '3';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 30,
      targetMaxPerDay: 5,
      userMaxPerDay: 3,
    });
  });

  it('accepts zero (disabled)', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = '0';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = '0';
    process.env.NOMINATION_USER_MAX_PER_DAY = '0';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 0,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });

  it('falls back to defaults for non-numeric values', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = 'banana';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = 'abc';
    process.env.NOMINATION_USER_MAX_PER_DAY = 'xyz';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 60,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });

  it('falls back to defaults for negative values', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = '-1';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = '-5';
    process.env.NOMINATION_USER_MAX_PER_DAY = '-10';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 60,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });

  it('falls back to defaults for float values', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = '3.5';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = '1.9';
    process.env.NOMINATION_USER_MAX_PER_DAY = '2.1';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 60,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });

  it('falls back to defaults for empty string values', async () => {
    process.env.NOMINATION_USER_COOLDOWN_SECONDS = '';
    process.env.NOMINATION_TARGET_MAX_PER_DAY = '';
    process.env.NOMINATION_USER_MAX_PER_DAY = '';
    expect(await getPolicy()).toEqual({
      userCooldownSeconds: 60,
      targetMaxPerDay: 0,
      userMaxPerDay: 0,
    });
  });
});
