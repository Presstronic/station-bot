import { afterEach, describe, expect, it } from '@jest/globals';
import { buildCitizenUrl, getRsiConfig, getRsiProfileEditUrl } from '../rsi.config.js';

describe('getRsiConfig', () => {
  const originalEnv = process.env.RSI_CITIZEN_URL_PATTERN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RSI_CITIZEN_URL_PATTERN;
    } else {
      process.env.RSI_CITIZEN_URL_PATTERN = originalEnv;
    }
  });

  it('returns the default URL pattern when RSI_CITIZEN_URL_PATTERN is not set', () => {
    delete process.env.RSI_CITIZEN_URL_PATTERN;
    const config = getRsiConfig();
    expect(config.citizenUrlPattern).toBe('https://robertsspaceindustries.com/en/citizens/{handle}');
  });

  it('returns the env-var URL pattern when RSI_CITIZEN_URL_PATTERN is set', () => {
    process.env.RSI_CITIZEN_URL_PATTERN = 'https://custom.example.com/citizens/{handle}';
    const config = getRsiConfig();
    expect(config.citizenUrlPattern).toBe('https://custom.example.com/citizens/{handle}');
  });

  it('falls back to the default when RSI_CITIZEN_URL_PATTERN is whitespace-only', () => {
    process.env.RSI_CITIZEN_URL_PATTERN = '   ';
    const config = getRsiConfig();
    expect(config.citizenUrlPattern).toBe('https://robertsspaceindustries.com/en/citizens/{handle}');
  });

  it('trims leading/trailing whitespace from RSI_CITIZEN_URL_PATTERN', () => {
    process.env.RSI_CITIZEN_URL_PATTERN = '  https://custom.example.com/citizens/{handle}  ';
    const config = getRsiConfig();
    expect(config.citizenUrlPattern).toBe('https://custom.example.com/citizens/{handle}');
  });

  it('returns the expected bio selectors', () => {
    const config = getRsiConfig();
    expect(config.bioParentSelector).toBe('div.entry.bio');
    expect(config.bioChildSelector).toBe('div.value');
  });
});

describe('getRsiProfileEditUrl', () => {
  const originalEnv = process.env.RSI_PROFILE_EDIT_URL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RSI_PROFILE_EDIT_URL;
    } else {
      process.env.RSI_PROFILE_EDIT_URL = originalEnv;
    }
  });

  it('returns the default URL when RSI_PROFILE_EDIT_URL is not set', () => {
    delete process.env.RSI_PROFILE_EDIT_URL;
    expect(getRsiProfileEditUrl()).toBe('https://robertsspaceindustries.com/en/account/profile');
  });

  it('returns the env-var URL when RSI_PROFILE_EDIT_URL is set', () => {
    process.env.RSI_PROFILE_EDIT_URL = 'https://custom.example.com/account/profile';
    expect(getRsiProfileEditUrl()).toBe('https://custom.example.com/account/profile');
  });

  it('falls back to the default when RSI_PROFILE_EDIT_URL is whitespace-only', () => {
    process.env.RSI_PROFILE_EDIT_URL = '   ';
    expect(getRsiProfileEditUrl()).toBe('https://robertsspaceindustries.com/en/account/profile');
  });

  it('trims leading/trailing whitespace from RSI_PROFILE_EDIT_URL', () => {
    process.env.RSI_PROFILE_EDIT_URL = '  https://custom.example.com/account/profile  ';
    expect(getRsiProfileEditUrl()).toBe('https://custom.example.com/account/profile');
  });
});

describe('buildCitizenUrl', () => {
  const originalEnv = process.env.RSI_CITIZEN_URL_PATTERN;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.RSI_CITIZEN_URL_PATTERN;
    } else {
      process.env.RSI_CITIZEN_URL_PATTERN = originalEnv;
    }
  });

  it('builds the expected URL with the default pattern', () => {
    delete process.env.RSI_CITIZEN_URL_PATTERN;
    expect(buildCitizenUrl('PilotOne')).toBe(
      'https://robertsspaceindustries.com/en/citizens/PilotOne'
    );
  });

  it('percent-encodes special characters in the handle', () => {
    delete process.env.RSI_CITIZEN_URL_PATTERN;
    expect(buildCitizenUrl('Pilot One')).toBe(
      'https://robertsspaceindustries.com/en/citizens/Pilot%20One'
    );
  });

  it('uses a custom URL pattern from the env var', () => {
    process.env.RSI_CITIZEN_URL_PATTERN = 'https://custom.example.com/citizens/{handle}';
    expect(buildCitizenUrl('PilotOne')).toBe('https://custom.example.com/citizens/PilotOne');
  });

  it('throws when the pattern does not contain the {handle} placeholder', () => {
    process.env.RSI_CITIZEN_URL_PATTERN = 'https://custom.example.com/citizens/MISSING';
    expect(() => buildCitizenUrl('PilotOne')).toThrow(
      'Invalid RSI_CITIZEN_URL_PATTERN configuration: expected the pattern to contain the "{handle}" placeholder.',
    );
  });

  it('trims leading/trailing whitespace from the handle before encoding', () => {
    delete process.env.RSI_CITIZEN_URL_PATTERN;
    expect(buildCitizenUrl('  PilotOne  ')).toBe(
      'https://robertsspaceindustries.com/en/citizens/PilotOne'
    );
  });
});
