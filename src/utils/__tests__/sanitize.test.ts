import { describe, expect, it } from '@jest/globals';
import { sanitizeForInlineCode, sanitizeForInlineText } from '../sanitize.js';

describe('sanitizeForInlineText', () => {
  it('replaces markdown/codeblock and line-break control characters', () => {
    expect(sanitizeForInlineText('alpha`beta|gamma\r\ndelta')).toBe("alpha'beta/gamma delta");
  });
});

describe('sanitizeForInlineCode', () => {
  it('preserves pipes while normalizing backticks and line breaks', () => {
    expect(sanitizeForInlineCode('alpha`beta|gamma\r\ndelta')).toBe("alpha'beta|gamma delta");
  });
});
