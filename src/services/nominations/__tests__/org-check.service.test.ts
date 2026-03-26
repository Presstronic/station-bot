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
  jest.unstable_mockModule('../../../workers/html-parse.pool.js', () => ({
    parseOrgOutcomeInWorker: jest.fn<() => Promise<string>>().mockResolvedValue(orgOutcome),
    parseCanonicalHandleInWorker: jest.fn<() => Promise<string>>().mockResolvedValue(canonicalHandle),
  }));
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
    mockPool('in_org');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotOne');

    expect(result.code).toBe('in_org');
    expect(result.status).toBe('in_org');
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
    mockPool('not_in_org');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotTwo');

    expect(result.code).toBe('not_in_org');
    expect(result.status).toBe('not_in_org');
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
    mockPool('undetermined');

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('PilotThree');

    expect(result.code).toBe('parse_failed');
    expect(result.status).toBe('unknown');
  });

  it('returns not_found when citizen profile is missing', async () => {
    const get = jest.fn<() => Promise<any>>().mockResolvedValueOnce({ status: 404, data: '', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('MissingPilot');

    expect(result.code).toBe('not_found');
    expect(result.status).toBe('unknown');
  });

  it('returns rate_limited when RSI responds with 429', async () => {
    const get = jest
      .fn<() => Promise<any>>()
      .mockResolvedValueOnce({ status: 200, data: '<html/>', headers: {} })
      .mockResolvedValueOnce({ status: 429, data: '', headers: {} });

    jest.unstable_mockModule('axios', () => ({ default: { get } }));
    jest.unstable_mockModule('../../../utils/logger.js', () => ({
      getLogger: () => ({ warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }),
    }));
    mockPool();

    const { checkHasAnyOrgMembership } = await import('../org-check.service.js');
    const result = await checkHasAnyOrgMembership('SlowPilot');

    expect(result.code).toBe('rate_limited');
    expect(result.status).toBe('unknown');
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
    mockPool('in_org', 'PilotNominee');

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('pilotnominee');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.canonicalHandle).toBe('PilotNominee');
    }
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
    mockPool('in_org', 'PilotNominee');

    const { checkCitizenExists } = await import('../org-check.service.js');
    const result = await checkCitizenExists('PilotNominee');

    expect(result.status).toBe('found');
    if (result.status === 'found') {
      expect(result.canonicalHandle).toBe('PilotNominee');
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
    expect(warn).toHaveBeenCalled();
  });
});
