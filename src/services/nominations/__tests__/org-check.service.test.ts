import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

const originalEnv = { ...process.env };

beforeEach(() => {
  jest.resetModules();
  process.env = {
    ...originalEnv,
    RSI_HTTP_MAX_RETRIES: '0',
    RSI_HTTP_RETRY_BASE_MS: '0',
    RSI_HTTP_MIN_INTERVAL_MS: '0',
  };
});

afterEach(() => {
  process.env = originalEnv;
});

function mockPool(orgOutcome: string = 'in_org', canonicalHandle: string = '') {
  const parseOrgOutcomeInWorker = jest
    .fn<(html: string) => Promise<string>>()
    .mockResolvedValue(orgOutcome);
  const parseCanonicalHandleInWorker = jest
    .fn<(html: string, fallback: string) => Promise<string>>()
    .mockResolvedValue(canonicalHandle);
  jest.unstable_mockModule('../../../workers/html-parse.pool.js', () => ({
    parseOrgOutcomeInWorker,
    parseCanonicalHandleInWorker,
  }));
  return { parseOrgOutcomeInWorker, parseCanonicalHandleInWorker };
}

describe('checkHasAnyOrgMembership', () => {
  it('returns in_org when parse worker reports in_org', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseOrgOutcomeInWorker } = mockPool('in_org');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotOne');

    expect(result.code).toBe('in_org');
    expect(result.status).toBe('in_org');
    expect(parseOrgOutcomeInWorker).toHaveBeenCalledWith('<html/>');
  });

  it('returns not_in_org when parse worker reports not_in_org', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseOrgOutcomeInWorker } = mockPool('not_in_org');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotTwo');

    expect(result.code).toBe('not_in_org');
    expect(result.status).toBe('not_in_org');
    expect(parseOrgOutcomeInWorker).toHaveBeenCalledWith('<html/>');
  });

  it('returns parse_failed when parse worker reports undetermined', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseOrgOutcomeInWorker } = mockPool('undetermined');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotThree');

    expect(result.code).toBe('parse_failed');
    expect(result.status).toBe('unknown');
    expect(parseOrgOutcomeInWorker).toHaveBeenCalledWith('<html/>');
  });

  it('returns parse_failed when parse worker rejects', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseOrgOutcomeInWorker } = mockPool();
    parseOrgOutcomeInWorker.mockRejectedValueOnce(new Error('worker crashed'));

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('CrashedWorkerPilot');

    expect(result.code).toBe('parse_failed');
    expect(result.status).toBe('unknown');
  });

  it('returns not_found when citizen profile is missing', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ status: 404, data: '', headers: {} });
    const warn = jest.fn();

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn, error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('MissingPilot');

    expect(result.code).toBe('not_found');
    expect(result.status).toBe('unknown');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('RSI citizen profile fetch failed (not_found)')
    );
  });

  it('returns rate_limited when RSI responds with 429', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 429, data: '', headers: {} });
    const warn = jest.fn();

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn, error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('SlowPilot');

    expect(result.code).toBe('rate_limited');
    expect(result.status).toBe('unknown');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('RSI organizations page fetch failed (rate_limited)')
    );
  });

  it('returns http_timeout when request times out (ECONNABORTED)', async () => {
    const timeoutError = Object.assign(new Error('timeout'), { code: 'ECONNABORTED' });
    const get = jest.fn<() => Promise<any>>().mockRejectedValueOnce(timeoutError);

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('TimeoutPilot');

    expect(result.code).toBe('http_timeout');
    expect(result.status).toBe('unknown');
  });

  it('returns http_timeout when AbortSignal cancels the request (ERR_CANCELED)', async () => {
    const canceledError = Object.assign(new Error('canceled'), { code: 'ERR_CANCELED' });
    const get = jest.fn<() => Promise<any>>().mockRejectedValueOnce(canceledError);

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('CanceledPilot');

    expect(result.code).toBe('http_timeout');
    expect(result.status).toBe('unknown');
  });
});

describe('checkCitizenExists', () => {
  it.each([
    ['1.7', 12000],
    ['-5', 12000],
    ['0', 12000],
    ['abc', 12000],
    ['2500', 2500],
  ])(
    'uses timeout %s -> effective axios timeout %i',
    async (configuredTimeout, expectedTimeout) => {
      process.env.RSI_HTTP_TIMEOUT_MS = configuredTimeout;

      const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({
        status: 200,
        data: '<html/>',
        headers: {},
      });

      jest.unstable_mockModule('axios', () => ({ default: { get } }));
      jest.unstable_mockModule('../../../utils/logger.js', () => ({
        getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
      }));
      mockPool('in_org', 'PilotNominee');

      const { checkCitizenExists } = await import('../org-check.service.js');
      await checkCitizenExists('pilotnominee');

      expect(get).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          timeout: expectedTimeout,
        })
      );
    }
  );

  it('returns found with canonical handle from parse worker', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({
      status: 200,
      data: '<html/>',
      headers: {},
    });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseCanonicalHandleInWorker } = mockPool('in_org', 'PilotNominee');

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('pilotnominee');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.canonicalHandle).toBe('PilotNominee');
    }
    expect(parseCanonicalHandleInWorker).toHaveBeenCalledWith('<html/>', 'pilotnominee');
  });

  it('returns found with submitted handle when parse worker returns fallback', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({
      status: 200,
      data: '<html/>',
      headers: {},
    });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseCanonicalHandleInWorker } = mockPool('in_org', 'PilotNominee');

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('PilotNominee');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.canonicalHandle).toBe('PilotNominee');
    }
    expect(parseCanonicalHandleInWorker).toHaveBeenCalledWith('<html/>', 'PilotNominee');
  });

  it('returns found with submitted handle when parse worker rejects', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({
      status: 200,
      data: '<html/>',
      headers: {},
    });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    const { parseCanonicalHandleInWorker } = mockPool();
    parseCanonicalHandleInWorker.mockRejectedValueOnce(new Error('worker crashed'));

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('FallbackPilot');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.canonicalHandle).toBe('FallbackPilot');
    }
  });

  it('returns not_found when citizen profile is missing', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ status: 404, data: '', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('GhostPilot');

    expect(result.status).toBe('not_found');
  });

  it('returns unavailable on transient RSI error', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ status: 500, data: '', headers: {} });
    const warn = jest.fn();

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn, error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('SlowPilot');

    expect(result.status).toBe('unavailable');
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('RSI citizen existence check failed (http_error)')
    );
  });
});
