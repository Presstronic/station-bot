import { describe, expect, it } from '@jest/globals';
import { sanitizeForInlineText } from '../sanitize.ts';

describe('sanitizeForInlineText', () => {
  it('replaces markdown/codeblock and line-break control characters', () => {
    expect(sanitizeForInlineText('alpha`beta|gamma\r\ndelta')).toBe("alpha'beta/gamma delta");
  });
});
