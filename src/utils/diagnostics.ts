import { subscribe } from 'node:diagnostics_channel';
import { performance } from 'node:perf_hooks';
import type { Client } from 'discord.js';
import { RESTEvents } from 'discord.js';
import type { APIRequest, RateLimitData, ResponseLike } from '@discordjs/rest';
import { getLogger } from './logger.js';

const LOOP_MONITOR_INTERVAL_MS = 100;
const LOOP_WARN_COOLDOWN_MS = 5_000;

// Discord interaction/webhook tokens are embedded in URL paths and are ≥50
// characters (URL-safe base64). Redact any such segment to prevent credential
// leakage into log sinks (e.g. Elasticsearch). Also strip query strings which
// may carry additional secret parameters.
// Example: /interactions/123/{token}/callback → /interactions/123/[token]/callback
const TOKEN_SEGMENT_RE = /\/[A-Za-z0-9_\-.~]{50,}/g;

function redactUrl(url: string): string {
  return url.split('?')[0].replace(TOKEN_SEGMENT_RE, '/[token]');
}

/**
 * Starts a periodic event loop lag monitor. Fires every 100 ms and logs a
 * warning whenever the actual firing is delayed beyond `thresholdMs`. A lag
 * reading above the threshold means the event loop was blocked — which would
 * prevent Discord REST response callbacks from running and can cause deferReply
 * to miss the 3-second acknowledgment deadline.
 *
 * The returned handle is unref'd so it does not prevent graceful shutdown.
 */
export function startEventLoopMonitor(thresholdMs = 50): NodeJS.Timeout {
  let lastTick = performance.now();
  // Initialise before the cooldown window so the very first lag spike is always logged.
  let lastWarnAt = -LOOP_WARN_COOLDOWN_MS;
  let suppressedCount = 0;

  const handle = setInterval(() => {
    const now = performance.now();
    const lag = now - lastTick - LOOP_MONITOR_INTERVAL_MS;
    lastTick = now;
    if (lag > thresholdMs) {
      if (now - lastWarnAt >= LOOP_WARN_COOLDOWN_MS) {
        const suppressed =
          suppressedCount > 0
            ? ` (${suppressedCount} similar warning${suppressedCount === 1 ? '' : 's'} suppressed)`
            : '';
        getLogger().warn(
          `Event loop lag: ${Math.round(lag)}ms (threshold: ${thresholdMs}ms)${suppressed}`
        );
        lastWarnAt = now;
        suppressedCount = 0;
      } else {
        suppressedCount++;
      }
    }
  }, LOOP_MONITOR_INTERVAL_MS);
  handle.unref();
  return handle;
}

/**
 * Attaches to discord.js REST client events and logs REST activity.
 * Only registers listeners when LOG_LEVEL is debug or trace — the handlers
 * fire on every REST call and their output is only useful when actively
 * debugging.
 *
 * Both listeners are only registered when LOG_LEVEL is debug or trace (see guard above).
 * response    → DEBUG
 * rateLimited → WARN
 *
 * Note: @discordjs/rest v2.x does not emit a Request event, so elapsed time
 * is not available here. Use subscribeUndiciDiagnostics() at LOG_LEVEL=trace
 * for per-request RTT and connection establishment timing.
 *
 * URL paths are redacted before logging to prevent interaction/webhook tokens
 * from appearing in log sinks.
 */
export function subscribeRestEvents(client: Client): void {
  const level = process.env.LOG_LEVEL ?? 'info';
  if (level !== 'debug' && level !== 'trace') return;

  const logger = getLogger();

  client.rest.on(RESTEvents.Response, (request: APIRequest, response: ResponseLike) => {
    logger.debug(`REST ← ${request.method} ${redactUrl(request.path)} ${response.status}`);
  });

  client.rest.on(RESTEvents.RateLimited, (data: RateLimitData) => {
    logger.warn(
      `REST rate limited: ${data.method} ${redactUrl(data.route)} — retry after ${data.retryAfter}ms (global=${data.global})`
    );
  });
}

/**
 * Subscribes to Node.js undici diagnostics_channel events to expose raw TCP
 * connection and HTTP request lifecycle data. Only active when LOG_LEVEL=trace
 * since these channels fire on every HTTP request made by the process.
 *
 * Key signals:
 *   undici:connect:start     → a new TCP connection is being established (pool miss / stale conn)
 *   undici:connect:connected → TCP+TLS handshake complete; time since connect:start = handshake cost
 *   undici:connect:error     → connection failed at the TCP layer
 *   undici:request:create    → HTTP request queued/sent
 *   undici:request:headers   → response headers received; time since request:create = full RTT
 *
 * URL paths are redacted before logging to prevent interaction/webhook tokens
 * from appearing in log sinks.
 */
// Idempotency guard: diagnostics_channel.subscribe() accumulates listeners on the
// channel — calling subscribeUndiciDiagnostics() twice would double-log every event.
let undiciSubscribed = false;

export function subscribeUndiciDiagnostics(): void {
  // Guard: undici channels fire on every HTTP request in the process.
  // Only subscribe when trace output is actually wanted to avoid unnecessary overhead.
  if (process.env.LOG_LEVEL !== 'trace') return;
  if (undiciSubscribed) return;
  undiciSubscribed = true;

  const logger = getLogger();

  // Track connect start times keyed by the connectParams object.
  const connectStartTimes = new WeakMap<object, number>();
  // Track request start times keyed by the request object.
  const requestStartTimes = new WeakMap<object, number>();

  subscribe('undici:connect:start', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { connectParams } = message as { connectParams: unknown };
    if (typeof connectParams !== 'object' || connectParams === null) return;
    const p = connectParams as { hostname: string; port: string | number };
    connectStartTimes.set(connectParams as object, Date.now());
    logger.trace(`undici connect:start → ${p.hostname}:${p.port}`);
  });

  subscribe('undici:connect:connected', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { connectParams } = message as { connectParams: unknown };
    if (typeof connectParams !== 'object' || connectParams === null) return;
    const p = connectParams as { hostname: string; port: string | number };
    const key = connectParams as object;
    const start = connectStartTimes.get(key);
    connectStartTimes.delete(key);
    const elapsed = start !== undefined ? `${Date.now() - start}ms` : '?ms';
    logger.trace(`undici connect:connected → ${p.hostname}:${p.port} (${elapsed})`);
  });

  subscribe('undici:connect:error', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { connectParams, error } = message as { connectParams: unknown; error: unknown };
    if (typeof connectParams !== 'object' || connectParams === null) return;
    const p = connectParams as { hostname: string; port: string | number };
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.trace(`undici connect:error → ${p.hostname}:${p.port}: ${errorMessage}`);
  });

  subscribe('undici:request:create', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { request } = message as { request: unknown };
    if (typeof request !== 'object' || request === null) return;
    const req = request as Record<string, unknown>;
    requestStartTimes.set(request as object, Date.now());
    const url = redactUrl(`${String(req.origin ?? '')}${String(req.path ?? '')}`);
    logger.trace(`undici request:create → ${String(req.method ?? 'GET')} ${url}`);
  });

  subscribe('undici:request:headers', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { request, response } = message as { request: unknown; response: unknown };
    if (typeof request !== 'object' || request === null) return;
    if (typeof response !== 'object' || response === null) return;
    const key = request as object;
    const start = requestStartTimes.get(key);
    requestStartTimes.delete(key);
    const elapsed = start !== undefined ? `${Date.now() - start}ms` : '?ms';
    const statusCode = (response as Record<string, unknown>).statusCode;
    logger.trace(`undici request:headers ← ${String(statusCode ?? '?')} (${elapsed})`);
  });

  subscribe('undici:request:error', (message: unknown) => {
    if (typeof message !== 'object' || message === null) return;
    const { request, error } = message as { request: unknown; error: unknown };
    if (typeof request !== 'object' || request === null) return;
    const req = request as Record<string, unknown>;
    requestStartTimes.delete(request as object);
    const url = redactUrl(`${String(req.origin ?? '')}${String(req.path ?? '')}`);
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.trace(`undici request:error → ${String(req.method ?? 'GET')} ${url}: ${errorMessage}`);
  });
}
