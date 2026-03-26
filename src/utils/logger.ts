import { createLogger, format, transports } from 'winston';
import type { Logger as WinstonLogger } from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import type Transport from 'winston-transport';
import { inspect } from 'node:util';
import { getCorrelationId } from './request-context.js';

// Custom level set — extends Winston's defaults with `trace` (most verbose).
// Lower number = higher severity; trace sits below debug.
const LEVELS = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  trace: 6,
};

// Augment the Winston logger type to expose the `trace` method added by the
// custom level set above.
export type AppLogger = WinstonLogger & {
  trace: WinstonLogger['debug'];
};

let loggerInstance: AppLogger | null = null;

export const getLogger = (): AppLogger => {
  if (loggerInstance) {
    return loggerInstance;
  }

  const logLevel = process.env.LOG_LEVEL || 'info';
  const esNode = process.env.ELASTICSEARCH_NODE;
  const falseValues = new Set(['0', 'false', 'no', 'off']);
  const fileLoggingEnabled = !falseValues.has((process.env.LOG_FILE_ENABLED ?? '').trim().toLowerCase());
  const loggerTransports: Transport[] = [new transports.Console()];

  if (fileLoggingEnabled) {
    loggerTransports.push(new transports.File({ filename: './logs/app.log' }));
  }

  if (esNode) {
    const esTransport = new ElasticsearchTransport({
      level: logLevel,
      clientOpts: { node: esNode },
    });
    esTransport.on('error', (err: unknown) => {
      // Cannot route through the logger here — doing so would risk infinite recursion
      // if the ES transport itself is the source of the error. Write directly to stderr
      // with only the error message (never the raw error object, which may contain the
      // ELASTICSEARCH_NODE URL including any embedded credentials).
      const message = err instanceof Error ? err.message : String(err);
      process.stderr.write(`[logger] Elasticsearch transport error (non-fatal): ${message}\n`);
    });
    loggerTransports.push(esTransport);
  }

  loggerInstance = createLogger({
    levels: LEVELS,
    level: logLevel,
    format: format.combine(
      format.errors({ stack: true }),
      format.splat(),
      format.timestamp(),
      format.printf((info) => {
        const { timestamp, level, message, stack, ...meta } = info;
        const splat = (info as Record<PropertyKey, unknown>)[Symbol.for('splat')];
        const correlationId = getCorrelationId();
        const correlationTag = correlationId ? ` [cid:${correlationId}]` : '';
        const renderedMessage =
          typeof message === 'string'
            ? message
            : inspect(message, { depth: 5, breakLength: 120, compact: true });
        const renderedStack =
          typeof stack === 'string' && stack.length > 0 ? `\n${stack}` : '';
        const renderedMetaFields: Record<string, unknown> = {};
        if (Object.keys(meta).length > 0) {
          renderedMetaFields.meta = meta;
        }
        if (Array.isArray(splat) && splat.length > 0) {
          renderedMetaFields.splat = splat;
        }
        const renderedMeta =
          Object.keys(renderedMetaFields).length > 0
            ? `\nmeta=${inspect(renderedMetaFields, { depth: 5, breakLength: 120, compact: true })}`
            : '';
        return `[${timestamp}] ${String(level).toUpperCase()}${correlationTag}: ${renderedMessage}${renderedStack}${renderedMeta}`;
      })
    ),
    transports: loggerTransports,
  }) as AppLogger;

  return loggerInstance;
};
