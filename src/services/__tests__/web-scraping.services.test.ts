import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

describe('scrapeAndCheckValueSpecific', () => {
  it('returns true when the parse worker finds the search value in the page', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    const result = await scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123');

    expect(result).toBe(true);
    expect(parseSelectorCheckInWorker).toHaveBeenCalledWith('<html/>', 'div.bio', 'div.value', 'CODE123');
  });

  it('returns false when the parse worker does not find the search value', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false);
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    const result = await scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123');

    expect(result).toBe(false);
  });

  it('rethrows when the HTTP request fails', async () => {
    const get = jest.fn<() => Promise<any>>().mockRejectedValueOnce(new Error('network error'));
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
    }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await expect(scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123'))
      .rejects.toThrow('network error');
  });

  it('rethrows when the parse worker rejects', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ data: '<html/>' });
    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../utils/logger.js', () => ({
      getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
    }));
    const parseSelectorCheckInWorker = jest
      .fn<() => Promise<boolean>>()
      .mockRejectedValueOnce(new Error('worker crashed'));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({ parseSelectorCheckInWorker }));

    const { scrapeAndCheckValueSpecific } = await import('../web-scraping.services.js');
    await expect(scrapeAndCheckValueSpecific('https://example.com', 'div.bio', 'div.value', 'CODE123'))
      .rejects.toThrow('worker crashed');
  });
});
