import { describe, expect, it } from '@jest/globals';
import { generateUuidV7 } from '../uuidv7.js';

describe('generateUuidV7', () => {
  it('returns a version 7 uuid with RFC4122 variant bits', () => {
    const uuid = generateUuidV7(new Date('2026-05-29T00:00:00.000Z'));

    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});
