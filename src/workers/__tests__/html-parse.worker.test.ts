import { describe, expect, it, jest } from '@jest/globals';

// Provide a fake parentPort so the module-level guard passes when imported outside a worker thread.
jest.unstable_mockModule('worker_threads', () => ({
  parentPort: { on: jest.fn(), postMessage: jest.fn() },
}));

describe('parseOrgOutcome', () => {
  it('returns in_org when page contains an /orgs/ link', async () => {
    const { parseOrgOutcome } = await import('../html-parse.worker.js');
    const html = '<html><body><a href="/orgs/EXAMPLEORG">Example Org</a></body></html>';
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
