import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

function mockRuntimeFlags(overrides: { rsiHttpTimeoutMs?: number } = {}) {
  jest.unstable_mockModule('../../config/runtime-flags.js', () => ({
    rsiHttpTimeoutMs: jest.fn(() => overrides.rsiHttpTimeoutMs ?? 12_000),
    isVerificationEnabled: jest.fn(() => true),
    isReadOnlyMode: jest.fn(() => false),
    isPurgeJobsEnabled: jest.fn(() => false),
    verifyRateLimitPerMinute: jest.fn(() => 1),
    verifyRateLimitPerHour: jest.fn(() => 10),
  }));
}

describe('scrapeAndCheckValueSpecific', () => {
  it('returns true when the parse worker finds the search value in the page', async () => {
    const get = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    mockRuntimeFlags();
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    const result = await scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123');

    expect(result).toBe(true);
    expect(parseSelectorCheckInWorker).toHaveBeenCalledWith('<html/>', 'div.bio', 'div.value', 'CODE123');
  });

  it('returns false when the parse worker does not find the search value', async () => {
    const get = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    mockRuntimeFlags();
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false);
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    const result = await scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123');

    expect(result).toBe(false);
  });

  it('logs via logger.error and rethrows when the HTTP request fails', async () => {
    const get = jest.fn<() => Promise<unknown>>().mockRejectedValueOnce(new Error('network error'));
    const error = jest.fn();
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error, info: jest.fn() }),
    }));
    mockRuntimeFlags();
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
    }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await expect(scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123'))
      .rejects.toThrow('network error');
    expect(error).toHaveBeenCalledWith('Error fetching the page', expect.objectContaining({ url: 'https://example.com' }));
  });

  it('logs via logger.error and rethrows when the parse worker rejects', async () => {
    const get = jest.fn<() => Promise<unknown>>().mockResolvedValueOnce({ data: '<html/>' });
    const error = jest.fn();
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error, info: jest.fn() }),
    }));
    mockRuntimeFlags();
    const parseSelectorCheckInWorker = jest
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('worker crashed'));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await expect(scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123'))
      .rejects.toThrow('worker crashed');
    expect(error).toHaveBeenCalledWith('Error fetching the page', expect.objectContaining({ url: 'https://example.com' }));
  });

  it('passes the configured timeout to axios.get', async () => {
    const get = jest.fn<(url: string, config?: unknown) => Promise<unknown>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    mockRuntimeFlags({ rsiHttpTimeoutMs: 100 });
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true),
    }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123');

    expect(get).toHaveBeenCalledWith('https://example.com', expect.objectContaining({ timeout: 100 }));
  });

  it('rejects (rethrows) when axios times out', async () => {
    const timeoutError = Object.assign(new Error('timeout of 100ms exceeded'), { code: 'ECONNABORTED' });
    const get = jest.fn<() => Promise<unknown>>().mockRejectedValueOnce(timeoutError);
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    mockRuntimeFlags({ rsiHttpTimeoutMs: 100 });
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
    }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await expect(scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123'))
      .rejects.toMatchObject({ code: 'ECONNABORTED' });
  });
});
