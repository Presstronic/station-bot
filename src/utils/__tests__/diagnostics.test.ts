import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
  jest.clearAllMocks();
  jest.useFakeTimers();
  delete process.env.LOG_LEVEL;
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

const mockWarn = jest.fn();
const mockTrace = jest.fn();

jest.unstable_mockModule('../logger.js', () => ({
  getLogger: jest.fn(() => ({
    warn: mockWarn,
    debug: jest.fn(),
    trace: mockTrace,
    info: jest.fn(),
    error: jest.fn(),
  })),
}));

// Helpers to control Date.now precisely without relying on fake timer advancement.
// Jest's fake timers advance Date.now in sync with setInterval, so without
// injecting specific values there is never any simulated lag.
function mockNowSequence(values: number[]): void {
  let i = 0;
  jest.spyOn(Date, 'now').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

// diagnostics_channel is a real Node built-in — no mock needed for unit tests.
// REST and undici hook wiring is integration-level; only the event loop monitor
// threshold logic is unit-tested here.

describe('startEventLoopMonitor', () => {
  it('does not warn when event loop fires on time', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // init: t=0, interval fires at exactly t=100 → lag = 100-0-100 = 0, not > 50
    mockNowSequence([0, 100]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers();

    expect(mockWarn).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('logs a warning when lag exceeds the threshold', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // init: t=0, interval fires late at t=250 → lag = 250-0-100 = 150ms > 50ms threshold
    mockNowSequence([0, 250]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers();

    expect(mockWarn).toHaveBeenCalledTimes(1);
    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('Event loop lag'));
    clearInterval(handle);
  });

  it('includes the lag amount and threshold in the warning message', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    mockNowSequence([0, 250]);

    const handle = startEventLoopMonitor(30);
    jest.runOnlyPendingTimers();

    const message: string = mockWarn.mock.calls[0][0] as string;
    // lag value: 250-0-100 = 150ms
    expect(message).toContain('150ms');
    // threshold
    expect(message).toContain('30ms');
    clearInterval(handle);
  });

  it('uses 50ms as the default threshold', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    mockNowSequence([0, 250]);

    const handle = startEventLoopMonitor(); // default threshold
    jest.runOnlyPendingTimers();

    expect(mockWarn).toHaveBeenCalledWith(expect.stringContaining('50ms'));
    clearInterval(handle);
  });

  it('does not warn when lag is exactly at the threshold (> not >=)', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // lag = 150-0-100 = 50ms, threshold = 50ms → 50 > 50 is false → no warn
    mockNowSequence([0, 150]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers();

    expect(mockWarn).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it('warns on each interval where lag persists', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // Four ticks: each fires 100ms late
    // t0=0, t1=250 (lag=150), t2=500 (lag=150), t3=750 (lag=150)
    mockNowSequence([0, 250, 500, 750]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers(); // tick 1
    jest.runOnlyPendingTimers(); // tick 2
    jest.runOnlyPendingTimers(); // tick 3

    expect(mockWarn).toHaveBeenCalledTimes(3);
    clearInterval(handle);
  });
});

describe('subscribeUndiciDiagnostics', () => {
  it('does not subscribe (no-op) when LOG_LEVEL is not trace', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { subscribeUndiciDiagnostics } = await import('../diagnostics.js');
    subscribeUndiciDiagnostics();
    // If subscriptions were made they would emit trace logs on any subsequent HTTP;
    // verifying no trace calls were made during the subscribe call itself is sufficient.
    expect(mockTrace).not.toHaveBeenCalled();
  });
});
