import { generateDrdntVerificationCode, generateVerificationCode } from '../verification-code.services.js';

describe('generateVerificationCode', () => {
  it('returns a 16-character string', () => {
    expect(generateVerificationCode()).toHaveLength(16);
  });

  it('contains only lowercase hex characters', () => {
    expect(generateVerificationCode()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces no duplicates across 1000 calls', () => {
    const codes = Array.from({ length: 1000 }, () => generateVerificationCode());
    const unique = new Set(codes);
    expect(unique.size).toBe(1000);
  });
});

describe('generateDrdntVerificationCode', () => {
  it('always starts with "DRDNT-"', () => {
    expect(generateDrdntVerificationCode()).toMatch(/^DRDNT-/);
  });

  it('has a 16-character lowercase hex suffix after the prefix', () => {
    const code = generateDrdntVerificationCode();
    const suffix = code.slice('DRDNT-'.length);
    expect(suffix).toMatch(/^[0-9a-f]{16}$/);
  });

  it('produces no duplicates across 1000 calls', () => {
    const codes = Array.from({ length: 1000 }, () => generateDrdntVerificationCode());
    const unique = new Set(codes);
    expect(unique.size).toBe(1000);
  });
});
