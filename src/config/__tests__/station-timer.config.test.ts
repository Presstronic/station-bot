import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import {
  isStationTimerEnabled,
  stationTimerMaxActivePerGuild,
  stationTimerMaxActivePerUser,
  stationTimerPollCron,
} from '../station-timer.config.js';

const VARS = [
  'STATION_TIMER_ENABLED',
  'STATION_TIMER_MAX_ACTIVE_PER_GUILD',
  'STATION_TIMER_MAX_ACTIVE_PER_USER',
  'STATION_TIMER_POLL_CRON',
] as const;

type EnvSnapshot = Partial<Record<(typeof VARS)[number], string>>;

let snapshot: EnvSnapshot;

beforeEach(() => {
  snapshot = {};
  for (const key of VARS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of VARS) {
    if (snapshot[key] === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = snapshot[key];
    }
  }
});

describe('station-timer config', () => {
  it('defaults to disabled with default caps and poll cron', () => {
    expect(isStationTimerEnabled()).toBe(false);
    expect(stationTimerMaxActivePerGuild()).toBe(30);
    expect(stationTimerMaxActivePerUser()).toBe(5);
    expect(stationTimerPollCron()).toBe('*/1 * * * *');
  });

  it('parses enabled flag truthy/falsy values', () => {
    process.env.STATION_TIMER_ENABLED = 'true';
    expect(isStationTimerEnabled()).toBe(true);

    process.env.STATION_TIMER_ENABLED = 'off';
    expect(isStationTimerEnabled()).toBe(false);
  });

  it('parses positive integer caps and falls back for invalid values', () => {
    process.env.STATION_TIMER_MAX_ACTIVE_PER_GUILD = '42';
    process.env.STATION_TIMER_MAX_ACTIVE_PER_USER = '7';
    expect(stationTimerMaxActivePerGuild()).toBe(42);
    expect(stationTimerMaxActivePerUser()).toBe(7);

    process.env.STATION_TIMER_MAX_ACTIVE_PER_GUILD = '0';
    process.env.STATION_TIMER_MAX_ACTIVE_PER_USER = 'abc';
    expect(stationTimerMaxActivePerGuild()).toBe(30);
    expect(stationTimerMaxActivePerUser()).toBe(5);
  });

  it('returns configured poll cron and falls back for blank value', () => {
    process.env.STATION_TIMER_POLL_CRON = '*/5 * * * *';
    expect(stationTimerPollCron()).toBe('*/5 * * * *');

    process.env.STATION_TIMER_POLL_CRON = '   ';
    expect(stationTimerPollCron()).toBe('*/1 * * * *');
  });
});
