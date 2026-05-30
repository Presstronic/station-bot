import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('exec hangar sync source', () => {
  it('parses the source script and derives an OPEN anchor', async () => {
    const { parseExecHangarSourceScript, deriveAnchorFromSourceConfig } = await import('../exec-hangar-sync-source.js');
    const script = `
      const CYCLE_DRIFT_MS = 129;
      const DESIGN_ONLINE_MIN = 65;
      const DESIGN_OFFLINE_MIN = 120;
      const INITIAL_OPEN_TIME = new Date('2026-05-23T09:17:10.315-04:00');
    `;

    const parsed = parseExecHangarSourceScript(script);
    const anchor = deriveAnchorFromSourceConfig(parsed, new Date('2026-05-23T13:30:00.000Z'));

    expect(parsed.openDurationMinutes).toBe(65);
    expect(parsed.closedDurationMinutes).toBe(120);
    expect(parsed.cycleDriftMs).toBe(129);
    expect(anchor.currentState).toBe('OPEN');
    expect(anchor.remainingMs).toBeGreaterThan(0);
    expect(anchor.openDurationMinutes).toBe(65);
    expect(anchor.closedDurationMinutes).toBe(120);
    expect(anchor.cycleOffsetMs).toBe(129);
  });

  it('derives a CLOSED anchor later in the cycle', async () => {
    const { parseExecHangarSourceScript, deriveAnchorFromSourceConfig } = await import('../exec-hangar-sync-source.js');
    const script = `
      const CYCLE_DRIFT_MS = 129;
      const DESIGN_ONLINE_MIN = 65;
      const DESIGN_OFFLINE_MIN = 120;
      const INITIAL_OPEN_TIME = new Date('2026-05-23T09:17:10.315-04:00');
    `;

    const parsed = parseExecHangarSourceScript(script);
    const anchor = deriveAnchorFromSourceConfig(parsed, new Date('2026-05-23T15:00:00.000Z'));

    expect(anchor.currentState).toBe('CLOSED');
    expect(anchor.remainingMs).toBeGreaterThan(0);
  });

  it('fetches and parses app.js via axios', async () => {
    const get = jest.fn<() => Promise<unknown>>().mockResolvedValue({
      data: `
        const CYCLE_DRIFT_MS = 0;
        const DESIGN_ONLINE_MIN = 60;
        const DESIGN_OFFLINE_MIN = 120;
        const INITIAL_OPEN_TIME = new Date('2026-05-23T00:00:00.000Z');
      `,
    });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../config/runtime-flags.js', () => ({
      rsiHttpTimeoutMs: jest.fn(() => 1234),
      isReadOnlyMode: jest.fn(() => false),
      isVerificationEnabled: jest.fn(() => true),
      verifyRateLimitPerMinute: jest.fn(() => 1),
      verifyRateLimitPerHour: jest.fn(() => 10),
    }));

    const { fetchExecHangarSyncAnchor } = await import('../exec-hangar-sync-source.js');
    const anchor = await fetchExecHangarSyncAnchor(new Date('2026-05-23T00:10:00.000Z'));

    expect(get).toHaveBeenCalledWith(
      'https://exec.xyxyll.com/app.js',
      expect.objectContaining({ timeout: 1234 }),
    );
    expect(anchor.source).toBe('exec.xyxyll.com');
  });

  it('rejects zero open duration from the remote script', async () => {
    const { parseExecHangarSourceScript } = await import('../exec-hangar-sync-source.js');
    const script = `
      const CYCLE_DRIFT_MS = 129;
      const DESIGN_ONLINE_MIN = 0;
      const DESIGN_OFFLINE_MIN = 120;
      const INITIAL_OPEN_TIME = new Date('2026-05-23T09:17:10.315-04:00');
    `;

    expect(() => parseExecHangarSourceScript(script)).toThrow(/Invalid open duration value/);
  });

  it('rejects zero closed duration from the remote script', async () => {
    const { parseExecHangarSourceScript } = await import('../exec-hangar-sync-source.js');
    const script = `
      const CYCLE_DRIFT_MS = 129;
      const DESIGN_ONLINE_MIN = 65;
      const DESIGN_OFFLINE_MIN = 0;
      const INITIAL_OPEN_TIME = new Date('2026-05-23T09:17:10.315-04:00');
    `;

    expect(() => parseExecHangarSourceScript(script)).toThrow(/Invalid closed duration value/);
  });

  it('rejects remote cycle drift that collapses the adjusted cycle length', async () => {
    const { parseExecHangarSourceScript } = await import('../exec-hangar-sync-source.js');
    const script = `
      const CYCLE_DRIFT_MS = -11100000;
      const DESIGN_ONLINE_MIN = 65;
      const DESIGN_OFFLINE_MIN = 120;
      const INITIAL_OPEN_TIME = new Date('2026-05-23T09:17:10.315-04:00');
    `;

    expect(() => parseExecHangarSourceScript(script)).toThrow(/Invalid cycle drift value/);
  });
});
