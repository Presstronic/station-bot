import { createLogger, format, transports } from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import type Transport from 'winston-transport';
import { inspect } from 'node:util';
import { getCorrelationId } from './request-context.ts';

let loggerInstance: ReturnType<typeof createLogger> | null = null;

export const getLogger = () => {
  if (loggerInstance) {
    return loggerInstance;
  }

  const logLevel = process.env.LOG_LEVEL || 'info';
  const esNode = process.env.ELASTICSEARCH_NODE;
  const fileLoggingEnabled = process.env.LOG_FILE_ENABLED !== 'false';
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
      // eslint-disable-next-line no-console
      console.error('[logger] Elasticsearch transport error (non-fatal):', err);
    });
    loggerTransports.push(esTransport);
  }

  loggerInstance = createLogger({
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
  });

  return loggerInstance;
};
