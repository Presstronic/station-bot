import { describe, expect, it } from '@jest/globals';
import { buildStartupBanner } from '../startup-banner.js';

const BASE_OPTIONS = {
  logLevel: 'debug',
  readOnlyMode: false,
  dbConfigured: true,
  nominationWorkerActive: true,
  purgeJobsEnabled: true,
  guildCount: 3,
  botTag: 'station-bot#0001',
  startedAt: '2026-03-25T04:00:00.000Z',
};

describe('buildStartupBanner', () => {
  it('returns a string', () => {
    expect(typeof buildStartupBanner(BASE_OPTIONS)).toBe('string');
  });

  it('contains box-drawing border characters', () => {
    const banner = buildStartupBanner(BASE_OPTIONS);
    expect(banner).toContain('╔');
    expect(banner).toContain('╗');
    expect(banner).toContain('╚');
    expect(banner).toContain('╝');
    expect(banner).toContain('╠');
    expect(banner).toContain('╣');
  });

  it('contains S T A T I O N   B O T title', () => {
    const banner = buildStartupBanner(BASE_OPTIONS);
    expect(banner).toContain('S T A T I O N   B O T');
  });

  it('reflects all provided option values', () => {
    const banner = buildStartupBanner(BASE_OPTIONS);
    expect(banner).toContain('debug');
    expect(banner).toContain('false'); // readOnlyMode
    expect(banner).toContain('true');  // dbConfigured
    expect(banner).toContain('enabled'); // nominationWorkerActive
    expect(banner).toContain('3');     // guildCount
    expect(banner).toContain('station-bot#0001');
    expect(banner).toContain('2026-03-25T04:00:00.000Z');
  });

  it('shows "disabled" when nomination worker is inactive', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, nominationWorkerActive: false });
    expect(banner).toContain('disabled');
  });

  it('shows "disabled" when purge jobs are off', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, purgeJobsEnabled: false });
    expect(banner).toContain('disabled');
  });

  it('includes the package version', () => {
    const banner = buildStartupBanner(BASE_OPTIONS);
    // Version is sourced from package.json — just assert the field label is present
    expect(banner).toContain('Version');
  });

  it('all lines have the same length', () => {
    const banner = buildStartupBanner(BASE_OPTIONS);
    const lines = banner.split('\n');
    const lengths = lines.map((l) => [...l].length); // spread to count codepoints
    const first = lengths[0];
    for (const len of lengths) {
      expect(len).toBe(first);
    }
  });
});
