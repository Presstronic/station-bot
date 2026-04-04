import { afterEach, describe, expect, it } from '@jest/globals';
import { buildCitizenUrl, getRsiConfig } from '../rsi.config.js';

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

  it('returns the expected bio selectors', () => {
    const config = getRsiConfig();
    expect(config.bioParentSelector).toBe('div.entry.bio');
    expect(config.bioChildSelector).toBe('div.value');
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
});
