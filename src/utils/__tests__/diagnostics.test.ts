import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { performance } from 'node:perf_hooks';

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
const mockSubscribe = jest.fn();

jest.unstable_mockModule('../logger.js', () => ({
  getLogger: jest.fn(() => ({
    warn: mockWarn,
    debug: jest.fn(),
    trace: mockTrace,
    info: jest.fn(),
    error: jest.fn(),
  })),
}));

// Mock node:diagnostics_channel so we can assert that subscribe() is or is not
// called — the function call itself is the observable effect of the guard.
jest.unstable_mockModule('node:diagnostics_channel', () => ({
  subscribe: mockSubscribe,
}));

// Helpers to control performance.now precisely without relying on fake timer advancement.
// Jest's fake timers advance performance.now in sync with setInterval, so without
// injecting specific values there is never any simulated lag.
function mockNowSequence(values: number[]): void {
  let i = 0;
  jest.spyOn(performance, 'now').mockImplementation(() => values[Math.min(i++, values.length - 1)]);
}

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

    const handle = startEventLoopMonitor();
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

  it('rate-limits warnings: only first fires within the 5s cooldown, rest are suppressed', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // Three ticks all lagging 150ms, but only the first is within a new 5s window.
    // t0=0 (init), t1=250 (lag=150 → warn), t2=500 (250ms since warn → suppressed),
    // t3=750 (500ms since warn → suppressed)
    mockNowSequence([0, 250, 500, 750]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers(); // tick 1 — warns
    jest.runOnlyPendingTimers(); // tick 2 — suppressed
    jest.runOnlyPendingTimers(); // tick 3 — suppressed

    expect(mockWarn).toHaveBeenCalledTimes(1);
    clearInterval(handle);
  });

  it('logs suppressed count when cooldown expires and lag persists', async () => {
    const { startEventLoopMonitor } = await import('../diagnostics.js');

    // t0=0 (init), t1=250 (lag=150 → warn #1, lastWarnAt=250),
    // t2=500 (suppressed, count=1), t3=750 (suppressed, count=2),
    // t4=5300 (lag=4450, 5300-250=5050 >= 5000 → warn #2 with "2 … suppressed")
    mockNowSequence([0, 250, 500, 750, 5300]);

    const handle = startEventLoopMonitor(50);
    jest.runOnlyPendingTimers(); // tick 1
    jest.runOnlyPendingTimers(); // tick 2
    jest.runOnlyPendingTimers(); // tick 3
    jest.runOnlyPendingTimers(); // tick 4

    expect(mockWarn).toHaveBeenCalledTimes(2);
    const secondMessage = mockWarn.mock.calls[1][0] as string;
    expect(secondMessage).toContain('2 similar warnings suppressed');
    clearInterval(handle);
  });
});

describe('subscribeUndiciDiagnostics', () => {
  it('does not call diagnostics_channel.subscribe when LOG_LEVEL is not trace or silly', async () => {
    process.env.LOG_LEVEL = 'debug';
    const { subscribeUndiciDiagnostics } = await import('../diagnostics.js');
    subscribeUndiciDiagnostics();
    expect(mockSubscribe).not.toHaveBeenCalled();
  });

  it('calls diagnostics_channel.subscribe for each undici channel when LOG_LEVEL=trace', async () => {
    process.env.LOG_LEVEL = 'trace';
    const { subscribeUndiciDiagnostics } = await import('../diagnostics.js');
    subscribeUndiciDiagnostics();
    const subscribedChannels = (mockSubscribe.mock.calls as [string, unknown][]).map(([channel]) => channel);
    expect(subscribedChannels).toContain('undici:connect:start');
    expect(subscribedChannels).toContain('undici:connect:connected');
    expect(subscribedChannels).toContain('undici:connect:error');
    expect(subscribedChannels).toContain('undici:request:create');
    expect(subscribedChannels).toContain('undici:request:headers');
    expect(subscribedChannels).toContain('undici:request:error');
  });
});

describe('redactUrl (via subscribeRestEvents logged output)', () => {
  it('redacts long token segments from Discord interaction paths', async () => {
    process.env.LOG_LEVEL = 'debug';

    const mockDebug = jest.fn();
    jest.unstable_mockModule('../logger.js', () => ({
      getLogger: jest.fn(() => ({
        warn: mockWarn,
        debug: mockDebug,
        trace: mockTrace,
        info: jest.fn(),
        error: jest.fn(),
      })),
    }));

    jest.unstable_mockModule('discord.js', () => ({
      RESTEvents: { Response: 'response', RateLimited: 'rateLimited' },
    }));

    const { subscribeRestEvents } = await import('../diagnostics.js');

    // Simulate a client.rest EventEmitter
    type Handler = (req: unknown, res: unknown) => void;
    let responseHandler: Handler | null = null;
    const mockClient = {
      rest: {
        on: jest.fn((event: string, handler: Handler) => {
          if (event === 'response') responseHandler = handler;
        }),
      },
    };

    subscribeRestEvents(mockClient as never);

    // Fire the response handler with a path that contains a token
    const token = 'A'.repeat(68);
    (responseHandler as unknown as Handler)({ method: 'POST', path: `/interactions/123/${token}/callback` }, { status: 200 });

    expect(mockDebug).toHaveBeenCalledWith(expect.stringContaining('[token]'));
    expect(mockDebug).not.toHaveBeenCalledWith(expect.stringContaining(token));
  });

  it('strips query strings from logged URLs', async () => {
    process.env.LOG_LEVEL = 'trace';
    const { subscribeUndiciDiagnostics } = await import('../diagnostics.js');
    subscribeUndiciDiagnostics();

    // Find the undici:request:create handler that was registered
    const createCall = (mockSubscribe.mock.calls as [string, (msg: unknown) => void][])
      .find(([channel]) => channel === 'undici:request:create');
    expect(createCall).toBeDefined();
    const createHandler = createCall![1];

    createHandler({ request: { method: 'GET', origin: 'https://example.com', path: '/api?secret=abc123' } });

    expect(mockTrace).toHaveBeenCalled();
    const logged = mockTrace.mock.calls[0][0] as string;
    expect(logged).not.toContain('secret=abc123');
  });
});
