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
  const loggerTransports: Transport[] = [
    new transports.Console(),
    new transports.File({ filename: './logs/app.log' }),
  ];

  if (esNode) {
    loggerTransports.push(
      new ElasticsearchTransport({
        level: logLevel,
        clientOpts: { node: esNode },
      })
    );
  }

  loggerInstance = createLogger({
    level: logLevel,
    format: format.combine(
      format.errors({ stack: true }),
      format.splat(),
      format.timestamp(),
      format.printf((info) => {
        const { timestamp, level, message, stack, ...meta } = info;
        const correlationId = getCorrelationId();
        const correlationTag = correlationId ? ` [cid:${correlationId}]` : '';
        const renderedMessage =
          typeof message === 'string'
            ? message
            : inspect(message, { depth: 5, breakLength: 120, compact: true });
        const renderedStack =
          typeof stack === 'string' && stack.length > 0 ? `\n${stack}` : '';
        const renderedMeta =
          Object.keys(meta).length > 0
            ? `\nmeta=${inspect(meta, { depth: 5, breakLength: 120, compact: true })}`
            : '';
        return `[${timestamp}] ${String(level).toUpperCase()}${correlationTag}: ${renderedMessage}${renderedStack}${renderedMeta}`;
      })
    ),
    transports: loggerTransports,
  });

  return loggerInstance;
};
