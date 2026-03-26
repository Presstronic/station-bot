import { subscribe } from 'node:diagnostics_channel';
import type { Client } from 'discord.js';
import { RESTEvents } from 'discord.js';
import type { APIRequest, RateLimitData, ResponseLike } from '@discordjs/rest';
import { getLogger } from './logger.js';

const LOOP_MONITOR_INTERVAL_MS = 100;

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
  let lastTick = Date.now();
  const handle = setInterval(() => {
    const now = Date.now();
    const lag = now - lastTick - LOOP_MONITOR_INTERVAL_MS;
    lastTick = now;
    if (lag > thresholdMs) {
      getLogger().warn(`Event loop lag: ${lag}ms (threshold: ${thresholdMs}ms)`);
    }
  }, LOOP_MONITOR_INTERVAL_MS);
  handle.unref();
  return handle;
}

/**
 * Attaches to discord.js REST client events and logs every outbound request,
 * its response status, and any rate-limit events.
 *
 * response    → DEBUG (visible at LOG_LEVEL=debug)
 * rateLimited → WARN  (visible at all levels)
 */
export function subscribeRestEvents(client: Client): void {
  const logger = getLogger();

  client.rest.on(RESTEvents.Response, (request: APIRequest, response: ResponseLike) => {
    logger.debug(`REST ← ${request.method} ${request.path} ${response.status}`);
  });

  client.rest.on(RESTEvents.RateLimited, (data: RateLimitData) => {
    logger.warn(
      `REST rate limited: ${data.method} ${data.route} — retry after ${data.retryAfter}ms (global=${data.global})`
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
 */
export function subscribeUndiciDiagnostics(): void {
  // Guard: undici channels fire on every HTTP request in the process.
  // Only subscribe when trace output is actually wanted to avoid unnecessary overhead.
  if (process.env.LOG_LEVEL !== 'trace') return;

  const logger = getLogger();

  // Track connect start times keyed by the connectParams object.
  const connectStartTimes = new WeakMap<object, number>();
  // Track request start times keyed by the request object.
  const requestStartTimes = new WeakMap<object, number>();

  subscribe('undici:connect:start', (message: unknown) => {
    const { connectParams } = message as { connectParams: { hostname: string; port: string | number } };
    connectStartTimes.set(connectParams, Date.now());
    logger.trace(`undici connect:start → ${connectParams.hostname}:${connectParams.port}`);
  });

  subscribe('undici:connect:connected', (message: unknown) => {
    const { connectParams } = message as { connectParams: { hostname: string; port: string | number } };
    const start = connectStartTimes.get(connectParams);
    connectStartTimes.delete(connectParams);
    const elapsed = start !== undefined ? `${Date.now() - start}ms` : '?ms';
    logger.trace(`undici connect:connected → ${connectParams.hostname}:${connectParams.port} (${elapsed})`);
  });

  subscribe('undici:connect:error', (message: unknown) => {
    const { connectParams, error } = message as {
      connectParams: { hostname: string; port: string | number };
      error: Error;
    };
    logger.trace(
      `undici connect:error → ${connectParams.hostname}:${connectParams.port}: ${error.message}`
    );
  });

  subscribe('undici:request:create', (message: unknown) => {
    const { request } = message as { request: object };
    const req = request as Record<string, unknown>;
    requestStartTimes.set(request, Date.now());
    logger.trace(
      `undici request:create → ${String(req.method ?? 'GET')} ${String(req.origin ?? '')}${String(req.path ?? '')}`
    );
  });

  subscribe('undici:request:headers', (message: unknown) => {
    const { request, response } = message as {
      request: object;
      response: { statusCode: number };
    };
    const start = requestStartTimes.get(request);
    requestStartTimes.delete(request);
    const elapsed = start !== undefined ? `${Date.now() - start}ms` : '?ms';
    logger.trace(`undici request:headers ← ${response.statusCode} (${elapsed})`);
  });

  subscribe('undici:request:error', (message: unknown) => {
    const { request, error } = message as { request: object; error: Error };
    const req = request as Record<string, unknown>;
    requestStartTimes.delete(request);
    logger.trace(
      `undici request:error → ${String(req.method ?? 'GET')} ${String(req.origin ?? '')}${String(req.path ?? '')}: ${error.message}`
    );
  });
}
