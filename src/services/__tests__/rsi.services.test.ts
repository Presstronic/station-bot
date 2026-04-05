import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

const LOGGER_MOCK = {
  getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
};

function makeLogger() {
  const info = jest.fn();
  const error = jest.fn();
  return {
    module: { getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error, info }) },
    info,
    error,
  };
}

describe('verifyRSIProfile', () => {
  it('returns verified:false and empty canonicalHandle when no verification data exists', async () => {
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => undefined),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({
      fetchHtml: jest.fn(),
    }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
      parseCanonicalHandleInWorker: jest.fn(),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('unknown-user')).toEqual({ verified: false, canonicalHandle: '' });
  });

  it('returns verified:true and canonicalHandle from scrape when the validation code is found', async () => {
    const fetchHtml = jest.fn<() => Promise<string>>().mockResolvedValueOnce('<html>page</html>');
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
    const parseCanonicalHandleInWorker = jest.fn<() => Promise<string>>().mockResolvedValueOnce('PilotOne');

    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'pilotone',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker,
      parseCanonicalHandleInWorker,
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    const result = await verifyRSIProfile('user-1');

    expect(result).toEqual({ verified: true, canonicalHandle: 'PilotOne' });
    expect(fetchHtml).toHaveBeenCalledTimes(1);
    expect(fetchHtml).toHaveBeenCalledWith(
      'https://robertsspaceindustries.com/en/citizens/pilotone'
    );
    expect(parseSelectorCheckInWorker).toHaveBeenCalledWith(
      '<html>page</html>', 'div.entry.bio', 'div.value', 'ABC-123'
    );
    expect(parseCanonicalHandleInWorker).toHaveBeenCalledWith('<html>page</html>', 'pilotone');
  });

  it('returns verified:false and canonicalHandle from scrape when the validation code is not found', async () => {
    const fetchHtml = jest.fn<() => Promise<string>>().mockResolvedValueOnce('<html>page</html>');
    const parseSelectorCheckInWorker = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false);
    const parseCanonicalHandleInWorker = jest.fn<() => Promise<string>>().mockResolvedValueOnce('PilotOne');

    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'pilotone',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker,
      parseCanonicalHandleInWorker,
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('user-1')).toEqual({ verified: false, canonicalHandle: 'PilotOne' });
  });

  it('returns verified:false and typed-input canonicalHandle when fetching fails', async () => {
    const fetchHtml = jest.fn<() => Promise<string>>().mockRejectedValueOnce(new Error('network error'));

    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
      parseCanonicalHandleInWorker: jest.fn(),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('user-1')).toEqual({ verified: false, canonicalHandle: 'TestHandle' });
  });

  it('logs info with outcome:passed when the validation code is found', async () => {
    const logger = makeLogger();
    const fetchHtml = jest.fn<() => Promise<string>>().mockResolvedValueOnce('<html>page</html>');
    jest.unstable_mockModule('../../utils/logger.js', () => logger.module);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'pilotone',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true),
      parseCanonicalHandleInWorker: jest.fn<() => Promise<string>>().mockResolvedValueOnce('PilotOne'),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    await verifyRSIProfile('user-1');

    expect(logger.info).toHaveBeenCalledWith('RSI profile verification completed', {
      userId: 'user-1',
      rsiHandle: 'pilotone',
      outcome: 'passed',
    });
  });

  it('logs info with outcome:failed when the validation code is not found', async () => {
    const logger = makeLogger();
    const fetchHtml = jest.fn<() => Promise<string>>().mockResolvedValueOnce('<html>page</html>');
    jest.unstable_mockModule('../../utils/logger.js', () => logger.module);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'pilotone',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false),
      parseCanonicalHandleInWorker: jest.fn<() => Promise<string>>().mockResolvedValueOnce('PilotOne'),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    await verifyRSIProfile('user-1');

    expect(logger.info).toHaveBeenCalledWith('RSI profile verification completed', {
      userId: 'user-1',
      rsiHandle: 'pilotone',
      outcome: 'failed',
    });
  });

  it('logs structured error with userId, rsiHandle, and error when the scrape throws', async () => {
    const logger = makeLogger();
    const networkError = new Error('network error');
    const fetchHtml = jest.fn<() => Promise<string>>().mockRejectedValueOnce(networkError);
    jest.unstable_mockModule('../../utils/logger.js', () => logger.module);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn(),
      parseCanonicalHandleInWorker: jest.fn(),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    await verifyRSIProfile('user-1');

    expect(logger.error).toHaveBeenCalledWith('RSI profile verification error', {
      userId: 'user-1',
      rsiHandle: 'TestHandle',
      error: networkError,
    });
  });

  it('makes no direct axios calls — all HTTP goes through fetchHtml', async () => {
    const fetchHtml = jest.fn<() => Promise<string>>().mockResolvedValueOnce('<html/>');
    const axiosHead = jest.fn();
    const axiosGet = jest.fn();
    jest.unstable_mockModule('axios', () => ({ default: { head: axiosHead, get: axiosGet } }));
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ fetchHtml }));
    jest.unstable_mockModule('../../workers/html-parse.pool.js', () => ({
      parseSelectorCheckInWorker: jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true),
      parseCanonicalHandleInWorker: jest.fn<() => Promise<string>>().mockResolvedValueOnce('TestHandle'),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    await verifyRSIProfile('user-1');

    expect(axiosHead).not.toHaveBeenCalled();
    expect(axiosGet).not.toHaveBeenCalled();
    expect(fetchHtml).toHaveBeenCalledTimes(1);
  });
});
