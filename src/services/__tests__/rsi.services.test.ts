import { beforeEach, describe, expect, it, jest } from '@jest/globals';

beforeEach(() => {
  jest.resetModules();
});

const LOGGER_MOCK = {
  getLogger: () => ({ debug: jest.fn(), warn: jest.fn(), error: jest.fn(), info: jest.fn() }),
};

describe('verifyRSIProfile', () => {
  it('returns false when no verification data exists for the user', async () => {
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => undefined),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({
      scrapeAndCheckValueSpecific: jest.fn(),
    }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('unknown-user')).toBe(false);
  });

  it('returns true when the validation code is found in the RSI bio', async () => {
    const scrapeAndCheckValueSpecific = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ scrapeAndCheckValueSpecific }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('user-1')).toBe(true);
    expect(scrapeAndCheckValueSpecific).toHaveBeenCalledTimes(1);
    expect(scrapeAndCheckValueSpecific).toHaveBeenCalledWith(
      'https://robertsspaceindustries.com/en/citizens/TestHandle',
      'div.entry.bio',
      'div.value',
      'ABC-123'
    );
  });

  it('returns false when the validation code is not found in the RSI bio', async () => {
    const scrapeAndCheckValueSpecific = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(false);
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ scrapeAndCheckValueSpecific }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('user-1')).toBe(false);
  });

  it('returns false and does not throw when scraping fails', async () => {
    const scrapeAndCheckValueSpecific = jest.fn<() => Promise<boolean>>().mockRejectedValueOnce(new Error('network error'));
    jest.unstable_mockModule('../../utils/logger.js', () => LOGGER_MOCK);
    jest.unstable_mockModule('../../commands/verify.js', () => ({
      getUserVerificationData: jest.fn(() => ({
        rsiProfileName: 'TestHandle',
        dreadnoughtValidationCode: 'ABC-123',
      })),
    }));
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ scrapeAndCheckValueSpecific }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    expect(await verifyRSIProfile('user-1')).toBe(false);
  });

  it('makes no direct axios calls (no redundant HEAD check)', async () => {
    const scrapeAndCheckValueSpecific = jest.fn<() => Promise<boolean>>().mockResolvedValueOnce(true);
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
    jest.unstable_mockModule('../web-scraping.services.js', () => ({ scrapeAndCheckValueSpecific }));

    const { verifyRSIProfile } = await import('../rsi.services.js');
    await verifyRSIProfile('user-1');

    // rsi.services must not call axios directly — all HTTP goes through scrapeAndCheckValueSpecific
    expect(axiosHead).not.toHaveBeenCalled();
    expect(axiosGet).not.toHaveBeenCalled();
    expect(scrapeAndCheckValueSpecific).toHaveBeenCalledTimes(1);
  });
});
