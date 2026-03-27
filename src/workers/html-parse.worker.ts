import { parentPort } from 'worker_threads';
import * as cheerio from 'cheerio';

export type OrgOutcome = 'in_org' | 'not_in_org' | 'undetermined';

// Payload types shared with html-parse.pool — the pool imports these, so when
// adding a new parse task here, be sure to update the pool implementation too.
export type ParseRequestBody =
  | { type: 'orgOutcome'; html: string }
  | { type: 'canonicalHandle'; html: string; fallback: string }
  | { type: 'selectorCheck'; html: string; parentSelector: string; childSelector: string; searchValue: string };

// Distributed add of the routing id across each member of the union.
type AddId<T> = T extends unknown ? T & { id: number } : never;
export type ParseRequest = AddId<ParseRequestBody>;

export type ParseResponse =
  | { id: number; ok: true; value: string }
  | { id: number; ok: false; error: string };

if (!parentPort) {
  throw new Error('html-parse.worker must be run as a worker thread');
}

export function parseOrgOutcome(html: string): OrgOutcome {
  const $ = cheerio.load(html);
  // Org pages render two anchors per org: an image-only thumbnail link and a
  // separate text link. Checking .first().text() would return empty string for
  // the thumbnail, so we check for the existence of any /orgs/ anchor instead.
  // Scoped to .orgs-content to avoid false positives from nav or page chrome.
  if ($('.orgs-content a[href*="/orgs/"]').length > 0) {
    return 'in_org';
  }

  const bodyText = $('body').text().toLowerCase();
  if (
    bodyText.includes('no organizations') ||
    bodyText.includes('no affiliation') ||
    (bodyText.includes('affiliation') && bodyText.includes('none'))
  ) {
    return 'not_in_org';
  }

  return 'undetermined';
}

export function parseCanonicalHandle(html: string, fallback: string): string {
  const $ = cheerio.load(html);
  const nick = $('span.nick').first().text().trim();
  return nick.length > 0 ? nick : fallback;
}

export function parseSelectorCheck(
  html: string,
  parentSelector: string,
  childSelector: string,
  searchValue: string
): boolean {
  const $ = cheerio.load(html);
  const value = $(parentSelector).find(childSelector).text();
  return value.includes(searchValue);
}

parentPort.on('message', (request: ParseRequest) => {
  let response: ParseResponse;
  try {
    if (request.type === 'orgOutcome') {
      response = { id: request.id, ok: true, value: parseOrgOutcome(request.html) };
    } else if (request.type === 'canonicalHandle') {
      response = { id: request.id, ok: true, value: parseCanonicalHandle(request.html, request.fallback) };
    } else if (request.type === 'selectorCheck') {
      response = { id: request.id, ok: true, value: parseSelectorCheck(request.html, request.parentSelector, request.childSelector, request.searchValue) ? 'true' : 'false' };
    } else {
      throw new Error(`Unknown request type: ${String((request as { type: unknown }).type)}`);
    }
  } catch (err) {
    response = { id: request.id, ok: false, error: String(err) };
  }
  parentPort!.postMessage(response);
});
