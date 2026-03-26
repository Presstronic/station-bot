import { parentPort } from 'worker_threads';
import * as cheerio from 'cheerio';

export type OrgOutcome = 'in_org' | 'not_in_org' | 'undetermined';

// Payload types shared with html-parse.pool — the pool imports these so that
// adding a new parse task here produces a compile error in the pool as well.
export type ParseRequestBody =
  | { type: 'orgOutcome'; html: string }
  | { type: 'canonicalHandle'; html: string; fallback: string };

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
  const orgLink = $('a[href*="/orgs/"]').first().text().trim();
  if (orgLink.length > 0) {
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

parentPort.on('message', (request: ParseRequest) => {
  let response: ParseResponse;
  try {
    if (request.type === 'orgOutcome') {
      response = { id: request.id, ok: true, value: parseOrgOutcome(request.html) };
    } else {
      response = { id: request.id, ok: true, value: parseCanonicalHandle(request.html, request.fallback) };
    }
  } catch (err) {
    response = { id: request.id, ok: false, error: String(err) };
  }
  parentPort!.postMessage(response);
});
