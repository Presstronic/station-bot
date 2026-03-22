import { describe, expect, it } from '@jest/globals';
import { toDateString, formatDuration } from '../date.js';

describe('toDateString', () => {
  it('extracts YYYY-MM-DD from a full ISO timestamp', () => {
    expect(toDateString('2026-03-14T15:30:45.123Z')).toBe('2026-03-14');
  });

  it('returns the value unchanged when already YYYY-MM-DD', () => {
    expect(toDateString('2026-03-14')).toBe('2026-03-14');
  });

  it('returns n/a for null', () => {
    expect(toDateString(null)).toBe('n/a');
  });

  it('returns n/a for undefined', () => {
    expect(toDateString(undefined)).toBe('n/a');
  });

  it('returns n/a for empty string', () => {
    expect(toDateString('')).toBe('n/a');
  });
});

describe('formatDuration', () => {
  it('returns "1 second" for 1', () => {
    expect(formatDuration(1)).toBe('1 second');
  });

  it('returns "45 seconds" for 45', () => {
    expect(formatDuration(45)).toBe('45 seconds');
  });

  it('returns "59 seconds" for 59', () => {
    expect(formatDuration(59)).toBe('59 seconds');
  });

  it('returns "1 minute" for 60', () => {
    expect(formatDuration(60)).toBe('1 minute');
  });

  it('returns "2 minutes" for 61–119 (rounds up to avoid understating wait)', () => {
    expect(formatDuration(61)).toBe('2 minutes');
    expect(formatDuration(90)).toBe('2 minutes');
    expect(formatDuration(119)).toBe('2 minutes');
  });

  it('returns "12 minutes" for 720', () => {
    expect(formatDuration(720)).toBe('12 minutes');
  });

  it('returns "1 hour" for 3599 (rounds up to next whole minute boundary)', () => {
    expect(formatDuration(3599)).toBe('1 hour');
  });

  it('returns "1 hour" for 3600', () => {
    expect(formatDuration(3600)).toBe('1 hour');
  });

  it('returns "1 hour and 4 minutes" for 3840', () => {
    expect(formatDuration(3840)).toBe('1 hour and 4 minutes');
  });

  it('returns "1 hour and 1 minute" for 3660', () => {
    expect(formatDuration(3660)).toBe('1 hour and 1 minute');
  });

  it('returns "2 hours" for 7200', () => {
    expect(formatDuration(7200)).toBe('2 hours');
  });

  it('returns "2 hours and 30 minutes" for 9000', () => {
    expect(formatDuration(9000)).toBe('2 hours and 30 minutes');
  });

  it('returns "0 seconds" for 0', () => {
    expect(formatDuration(0)).toBe('0 seconds');
  });

  it('rounds up fractional seconds', () => {
    expect(formatDuration(1.9)).toBe('2 seconds');
  });

  it('clamps negative values to 0 seconds', () => {
    expect(formatDuration(-10)).toBe('0 seconds');
  });
});
