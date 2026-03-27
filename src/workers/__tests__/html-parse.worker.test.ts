import { describe, expect, it, jest } from '@jest/globals';

// Provide a fake parentPort so the module-level guard passes when imported outside a worker thread.
jest.unstable_mockModule('worker_threads', () => ({
  parentPort: { on: jest.fn(), postMessage: jest.fn() },
}));

describe('parseOrgOutcome', () => {
  it('returns in_org when page contains an /orgs/ link with text', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body><a href="/orgs/EXAMPLEORG">Example Org</a></body></html>';
    expect(parseOrgOutcome(html)).toBe('in_org');
  });

  it('returns in_org when the /orgs/ link contains only an image (no text)', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    // RSI org pages render a thumbnail anchor before the text anchor — the first
    // match has no text content, only an <img> child.
    const html = '<html><body><a href="/orgs/EXAMPLEORG"><img src="/logo.png" /></a></body></html>';
    expect(parseOrgOutcome(html)).toBe('in_org');
  });

  it('returns not_in_org when page contains "no organizations"', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body>No organizations found</body></html>';
    expect(parseOrgOutcome(html)).toBe('not_in_org');
  });

  it('returns not_in_org when page contains "no affiliation"', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body>No affiliation listed</body></html>';
    expect(parseOrgOutcome(html)).toBe('not_in_org');
  });

  it('returns not_in_org when page contains "affiliation" and "none"', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body>Affiliation: none</body></html>';
    expect(parseOrgOutcome(html)).toBe('not_in_org');
  });

  it('returns undetermined when page content is unrecognized', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body>Affiliation data unavailable</body></html>';
    expect(parseOrgOutcome(html)).toBe('undetermined');
  });

  it('returns undetermined on empty body', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body></body></html>';
    expect(parseOrgOutcome(html)).toBe('undetermined');
  });
});

describe('parseSelectorCheck', () => {
  it('returns true when the child element text contains the search value', async () => {
    const { parseSelectorCheck } = await import('../html-parse.worker.js');
    const html = '<html><body><div class="entry bio"><div class="value">VERIFY-ABC123</div></div></body></html>';
    expect(parseSelectorCheck(html, 'div.entry.bio', 'div.value', 'VERIFY-ABC123')).toBe(true);
  });

  it('returns false when the child element text does not contain the search value', async () => {
    const { parseSelectorCheck } = await import('../html-parse.worker.js');
    const html = '<html><body><div class="entry bio"><div class="value">some other text</div></div></body></html>';
    expect(parseSelectorCheck(html, 'div.entry.bio', 'div.value', 'VERIFY-ABC123')).toBe(false);
  });

  it('returns false when the parent element is absent', async () => {
    const { parseSelectorCheck } = await import('../html-parse.worker.js');
    const html = '<html><body><p>no matching structure here</p></body></html>';
    expect(parseSelectorCheck(html, 'div.entry.bio', 'div.value', 'VERIFY-ABC123')).toBe(false);
  });

  it('returns true for a partial match within the child text', async () => {
    const { parseSelectorCheck } = await import('../html-parse.worker.js');
    const html = '<html><body><div class="entry bio"><div class="value">prefix VERIFY-ABC123 suffix</div></div></body></html>';
    expect(parseSelectorCheck(html, 'div.entry.bio', 'div.value', 'VERIFY-ABC123')).toBe(true);
  });
});

describe('parseCanonicalHandle', () => {
  it('returns the nick element text when present', async () => {
    const { parseCanonicalHandle } = await import('../html-parse.worker.js');
    const html = '<html><body><span class="nick">PilotNominee</span></body></html>';
    expect(parseCanonicalHandle(html, 'fallback')).toBe('PilotNominee');
  });

  it('returns the fallback when nick element is absent', async () => {
    const { parseCanonicalHandle } = await import('../html-parse.worker.js');
    const html = '<html><body>Citizen page</body></html>';
    expect(parseCanonicalHandle(html, 'FallbackHandle')).toBe('FallbackHandle');
  });

  it('returns the fallback when nick element is empty', async () => {
    const { parseCanonicalHandle } = await import('../html-parse.worker.js');
    const html = '<html><body><span class="nick">   </span></body></html>';
    expect(parseCanonicalHandle(html, 'FallbackHandle')).toBe('FallbackHandle');
  });

  it('uses the first nick element when multiple are present', async () => {
    const { parseCanonicalHandle } = await import('../html-parse.worker.js');
    const html = '<html><body><span class="nick">FirstNick</span><span class="nick">SecondNick</span></body></html>';
    expect(parseCanonicalHandle(html, 'fallback')).toBe('FirstNick');
  });
});
