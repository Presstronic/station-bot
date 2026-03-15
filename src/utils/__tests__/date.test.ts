import { describe, expect, it } from '@jest/globals';
import { toDateString } from '../date.ts';

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
