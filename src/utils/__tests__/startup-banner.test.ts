import { describe, expect, it } from '@jest/globals';
import { buildStartupBanner } from '../startup-banner.js';

const BASE_OPTIONS = {
  version: '1.2.3',
  nodeVersion: 'v20.11.0',
  environment: 'test',
  logLevel: 'debug',
  readOnlyMode: false,
  dbConfigured: true,
  nominationWorkerActive: true,
  purgeJobsEnabled: true,
  rsiVerificationEnabled: true,
  manufacturingOrdersEnabled: true,
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
    expect(banner).toContain('1.2.3'); // version
    expect(banner).toContain('v20.11.0'); // nodeVersion
    expect(banner).toContain('test'); // environment
    expect(banner).toContain('debug'); // logLevel
    expect(banner).toContain('false'); // readOnlyMode
    expect(banner).toContain('true'); // dbConfigured
    expect(banner).toMatch(/Nom\. worker\s+: enabled/); // nominationWorkerActive
    expect(banner).toMatch(/Purge jobs\s+: enabled/); // purgeJobsEnabled
    expect(banner).toMatch(/RSI Verification\s+: enabled/); // rsiVerificationEnabled
    expect(banner).toMatch(/Mfg\. Orders\s+: enabled/); // manufacturingOrdersEnabled
    expect(banner).toMatch(/Guilds\s+: 3/); // guildCount — unambiguous, not matched by '1.2.3'
    expect(banner).toContain('station-bot#0001');
    expect(banner).toContain('2026-03-25T04:00:00.000Z');
  });

  it('shows "disabled" when nomination worker is inactive', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, nominationWorkerActive: false });
    expect(banner).toMatch(/Nom\. worker\s+: disabled/);
  });

  it('shows "disabled" when purge jobs are off', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, purgeJobsEnabled: false });
    expect(banner).toMatch(/Purge jobs\s+: disabled/);
  });

  it('shows "enabled" when rsi verification is on', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, rsiVerificationEnabled: true });
    expect(banner).toMatch(/RSI Verification\s+: enabled/);
  });

  it('shows "enabled" when manufacturing orders are on', () => {
    const banner = buildStartupBanner({ ...BASE_OPTIONS, manufacturingOrdersEnabled: true });
    expect(banner).toMatch(/Mfg\. Orders\s+: enabled/);
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

  it('truncates a value that exceeds the inner width and all lines remain equal length', () => {
    const longTag = 'a'.repeat(80);
    const banner = buildStartupBanner({ ...BASE_OPTIONS, botTag: longTag });
    const lines = banner.split('\n');
    const lengths = lines.map((l) => [...l].length);
    const first = lengths[0];
    for (const len of lengths) {
      expect(len).toBe(first);
    }
    // The long value must have been truncated with an ellipsis
    expect(banner).toContain('…');
  });
});
