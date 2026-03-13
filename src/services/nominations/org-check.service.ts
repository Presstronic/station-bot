import axios from 'axios';
import * as cheerio from 'cheerio';
import type { OrgCheckResult, OrgCheckResultCode, OrgCheckStatus } from './types.ts';
import { getLogger } from '../../utils/logger.ts';
import { sanitizeForInlineText } from '../../utils/sanitize.ts';

const defaultCitizenPattern = 'https://robertsspaceindustries.com/en/citizens/{handle}';
const defaultOrganizationsPattern = 'https://robertsspaceindustries.com/en/citizens/{handle}/organizations';
const defaultTimeoutMs = 12000;
const defaultMaxRetries = 2;
const defaultRetryBaseMs = 500;
const defaultMaxConcurrency = 2;
const defaultMinIntervalMs = 400;

const logger = getLogger();

function parseEnvInt(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw.trim() === '') {
    return defaultValue;
  }
  const value = Number(raw);
  return Number.isFinite(value) ? value : defaultValue;
}

const requestTimeoutMs = Math.max(1, parseEnvInt('RSI_HTTP_TIMEOUT_MS', defaultTimeoutMs));
const maxRetries = Math.max(0, parseEnvInt('RSI_HTTP_MAX_RETRIES', defaultMaxRetries));
const retryBaseMs = Math.max(0, parseEnvInt('RSI_HTTP_RETRY_BASE_MS', defaultRetryBaseMs));
const maxConcurrency = Math.max(
  1,
  parseEnvInt('RSI_HTTP_MAX_CONCURRENCY', defaultMaxConcurrency)
);
const minIntervalMs = Math.max(0, parseEnvInt('RSI_HTTP_MIN_INTERVAL_MS', defaultMinIntervalMs));

let activeRequests = 0;
let lastStartedAt = 0;
let drainTimer: NodeJS.Timeout | null = null;
const waitQueue: Array<() => void> = [];

function buildCitizenUrl(handle: string): string {
  const pattern = process.env.RSI_CITIZEN_URL_PATTERN || defaultCitizenPattern;
  return pattern.replace('{handle}', encodeURIComponent(handle.trim()));
}

function buildOrganizationsUrl(handle: string): string {
  const pattern = process.env.RSI_ORGANIZATIONS_URL_PATTERN || defaultOrganizationsPattern;
  return pattern.replace('{handle}', encodeURIComponent(handle.trim()));
}

function scheduleDrain(delayMs: number): void {
  if (drainTimer) {
    return;
  }
  drainTimer = setTimeout(() => {
    drainTimer = null;
    drainQueue();
  }, delayMs);
}

function drainQueue(): void {
  if (activeRequests >= maxConcurrency || waitQueue.length === 0) {
    return;
  }

  const now = Date.now();
  const elapsed = now - lastStartedAt;
  if (elapsed < minIntervalMs) {
    scheduleDrain(minIntervalMs - elapsed);
    return;
  }

  const next = waitQueue.shift();
  if (!next) {
    return;
  }
  activeRequests += 1;
  lastStartedAt = Date.now();
  next();
}

async function withRateLimit<T>(task: () => Promise<T>): Promise<T> {
  await new Promise<void>((resolve) => {
    waitQueue.push(resolve);
    drainQueue();
  });

  try {
    return await task();
  } finally {
    activeRequests -= 1;
    drainQueue();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type FetchCode = 'not_found' | 'http_timeout' | 'rate_limited' | 'http_error';
type TechnicalResultCode = Exclude<OrgCheckResultCode, 'in_org' | 'not_in_org' | 'not_found'>;

type FetchResult =
  | { ok: true; html: string }
  | { ok: false; code: FetchCode; message: string };

function trimMessage(message: string, maxLength = 180): string {
  const sanitized = sanitizeForInlineText(message);
  if (sanitized.length <= maxLength) {
    return sanitized;
  }
  return `${sanitized.slice(0, maxLength - 3)}...`;
}

function createTechnicalResult(code: TechnicalResultCode, message: string): OrgCheckResult {
  return {
    code,
    status: 'unknown',
    message: trimMessage(message),
    checkedAt: new Date().toISOString(),
  };
}

function mapFetchFailureToOrgCheckResult(code: FetchCode, message: string): OrgCheckResult {
  if (code === 'not_found') {
    return {
      code: 'not_found',
      status: 'unknown',
      message: trimMessage(message),
      checkedAt: new Date().toISOString(),
    };
  }

  return createTechnicalResult(code, message);
}

async function fetchPageWithReason(url: string): Promise<FetchResult> {
  let attempt = 0;
  while (attempt <= maxRetries) {
    try {
      const response = await withRateLimit(async () =>
        axios.get<string>(url, {
          timeout: requestTimeoutMs,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'station-bot/1.0 (+discord nomination review)',
          },
        })
      );

      if (response.status === 200 && response.data) {
        return { ok: true, html: response.data };
      }

      if (response.status === 404) {
        return { ok: false, code: 'not_found', message: `RSI page not found (${url})` };
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt >= maxRetries) {
          return {
            ok: false,
            code: response.status === 429 ? 'rate_limited' : 'http_error',
            message: `RSI response ${response.status} for URL ${url}`,
          };
        }
        const retryAfterHeader = response.headers['retry-after'];
        const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : NaN;
        const backoffMs = Number.isFinite(retryAfterMs)
          ? retryAfterMs
          : retryBaseMs * Math.pow(2, attempt);
        await sleep(backoffMs);
        attempt += 1;
        continue;
      }

      return {
        ok: false,
        code: 'http_error',
        message: `Unexpected RSI response ${response.status} for URL ${url}`,
      };
    } catch (error) {
      const timeoutCode =
        typeof error === 'object' &&
        error &&
        'code' in error &&
        (error as { code?: string }).code === 'ECONNABORTED';

      if (attempt >= maxRetries) {
        if (timeoutCode) {
          return {
            ok: false,
            code: 'http_timeout',
            message: `Request timeout after ${requestTimeoutMs}ms for URL ${url}`,
          };
        }
        return {
          ok: false,
          code: 'http_error',
          message: `Request failed for URL ${url}: ${String(error)}`,
        };
      }
      await sleep(retryBaseMs * Math.pow(2, attempt));
      attempt += 1;
    }
  }

  return {
    ok: false,
    code: 'http_error',
    message: `Request retries exhausted for URL ${url}`,
  };
}

function parseOrgStatusFromOrganizationsPage(html: string): OrgCheckStatus {
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

  return 'unknown';
}

export type CitizenExistsResult = 'found' | 'not_found' | 'unavailable';

/**
 * Checks whether an RSI citizen profile exists.
 * Returns 'found' if the profile page is reachable, 'not_found' if it returns 404,
 * and 'unavailable' for any transient error (timeout, server error, etc.) so callers
 * can fail open and not block nominations due to RSI availability issues.
 */
export async function checkCitizenExists(rsiHandle: string): Promise<CitizenExistsResult> {
  const citizenUrl = buildCitizenUrl(rsiHandle.trim());
  const result = await fetchPageWithReason(citizenUrl);
  if (!result.ok) {
    if (result.code === 'not_found') return 'not_found';
    logger.warn(
      `RSI citizen existence check failed (${result.code}) for handle "${sanitizeForInlineText(rsiHandle)}": ${trimMessage(result.message, 120)}`
    );
    return 'unavailable';
  }
  return 'found';
}

export async function checkHasAnyOrgMembership(rsiHandle: string): Promise<OrgCheckResult> {
  const normalizedHandle = rsiHandle.trim();
  const safeHandle = sanitizeForInlineText(normalizedHandle);
  const citizenUrl = buildCitizenUrl(normalizedHandle);
  const organizationsUrl = buildOrganizationsUrl(normalizedHandle);

  const citizenPage = await fetchPageWithReason(citizenUrl);
  if (!citizenPage.ok) {
    logger.warn(
      `RSI citizen profile fetch failed (${citizenPage.code}) for handle "${safeHandle}": ${trimMessage(citizenPage.message, 120)}`
    );
    return mapFetchFailureToOrgCheckResult(
      citizenPage.code,
      citizenPage.message
    );
  }

  const organizationsPage = await fetchPageWithReason(organizationsUrl);
  if (!organizationsPage.ok) {
    logger.warn(
      `RSI organizations page fetch failed (${organizationsPage.code}) for handle "${safeHandle}": ${trimMessage(organizationsPage.message, 120)}`
    );
    return mapFetchFailureToOrgCheckResult(
      organizationsPage.code,
      organizationsPage.message
    );
  }

  const status = parseOrgStatusFromOrganizationsPage(organizationsPage.html);
  if (status === 'unknown') {
    return createTechnicalResult(
      'parse_failed',
      `Could not infer organization status from organizations page for handle "${safeHandle}"`
    );
  }

  return {
    code: status,
    status,
    checkedAt: new Date().toISOString(),
  };
}
