import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

afterEach(() => {
  jest.restoreAllMocks();
});

type MessageHandler = (response: { id: number; ok: boolean; value?: string; error?: string }) => void;
type ErrorHandler = (err: Error) => void;
type ExitHandler = (code: number) => void;

function makeMockWorker() {
  let messageHandler: MessageHandler | null = null;
  let errorHandler: ErrorHandler | null = null;
  let exitHandler: ExitHandler | null = null;
  const posted: Array<{ id: number; type: string; html: string; fallback?: string }> = [];

  const worker = {
    on: jest.fn((event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'message') messageHandler = handler as MessageHandler;
      if (event === 'error')   errorHandler   = handler as ErrorHandler;
      if (event === 'exit')    exitHandler    = handler as ExitHandler;
      return worker;
    }),
    postMessage: jest.fn((msg: { id: number; type: string; html: string; fallback?: string }) => {
      posted.push(msg);
    }),
    emit: {
      message: (response: Parameters<MessageHandler>[0]) => messageHandler?.(response),
      error:   (err: Error)    => errorHandler?.(err),
      exit:    (code: number)  => exitHandler?.(code),
    },
    posted,
  };

  return worker;
}

describe('parseOrgOutcomeInWorker', () => {
  it('sends an orgOutcome request to the worker and resolves with the returned value', async () => {
    const mockWorker = makeMockWorker();

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseOrgOutcomeInWorker } = await import('../html-parse.pool.js');

    const promise = parseOrgOutcomeInWorker('<html/>');

    expect(mockWorker.posted).toHaveLength(1);
    expect(mockWorker.posted[0].type).toBe('orgOutcome');
    expect(mockWorker.posted[0].html).toBe('<html/>');

    const { id } = mockWorker.posted[0];
    mockWorker.emit.message({ id, ok: true, value: 'in_org' });

    await expect(promise).resolves.toBe('in_org');
  });

  it('rejects when the worker returns ok:false', async () => {
    const mockWorker = makeMockWorker();

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseOrgOutcomeInWorker } = await import('../html-parse.pool.js');

    const promise = parseOrgOutcomeInWorker('<html/>');
    const { id } = mockWorker.posted[0];
    mockWorker.emit.message({ id, ok: false, error: 'parse blew up' });

    await expect(promise).rejects.toThrow('parse blew up');
  });

  it('rejects and clears pending promises when the worker emits an error', async () => {
    const mockWorker = makeMockWorker();

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseOrgOutcomeInWorker } = await import('../html-parse.pool.js');

    const promise = parseOrgOutcomeInWorker('<html/>');
    mockWorker.emit.error(new Error('worker crashed'));

    await expect(promise).rejects.toThrow('worker crashed');
  });

  it('rejects pending promises when the worker exits with a non-zero code', async () => {
    const mockWorker = makeMockWorker();

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseOrgOutcomeInWorker } = await import('../html-parse.pool.js');

    const promise = parseOrgOutcomeInWorker('<html/>');
    mockWorker.emit.exit(1);

    await expect(promise).rejects.toThrow('exited unexpectedly');
  });

  it('rejects and removes the pending entry when postMessage throws synchronously', async () => {
    const mockWorker = makeMockWorker();
    mockWorker.postMessage.mockImplementation(() => {
      throw new Error('worker terminated');
    });

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseOrgOutcomeInWorker } = await import('../html-parse.pool.js');

    await expect(parseOrgOutcomeInWorker('<html/>')).rejects.toThrow('Failed to send message to html-parse worker');
    // Pending entry must be cleaned up — a subsequent successful call should resolve normally.
    mockWorker.postMessage.mockImplementation((msg: { id: number }) => {
      mockWorker.posted.push(msg as typeof mockWorker.posted[0]);
    });
    const promise2 = parseOrgOutcomeInWorker('<html/>');
    mockWorker.emit.message({ id: mockWorker.posted[0].id, ok: true, value: 'not_in_org' });
    await expect(promise2).resolves.toBe('not_in_org');
  });
});

describe('parseCanonicalHandleInWorker', () => {
  it('sends a canonicalHandle request to the worker and resolves with the returned value', async () => {
    const mockWorker = makeMockWorker();

    jest.unstable_mockModule('worker_threads', () => ({
      Worker: jest.fn(() => mockWorker),
    }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));

    const { parseCanonicalHandleInWorker } = await import('../html-parse.pool.js');

    const promise = parseCanonicalHandleInWorker('<html/>', 'FallbackHandle');

    expect(mockWorker.posted).toHaveLength(1);
    expect(mockWorker.posted[0].type).toBe('canonicalHandle');
    expect(mockWorker.posted[0].fallback).toBe('FallbackHandle');

    const { id } = mockWorker.posted[0];
    mockWorker.emit.message({ id, ok: true, value: 'CanonicalHandle' });

    await expect(promise).resolves.toBe('CanonicalHandle');
  });
});
