import { createLogger, format, transports } from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';
import Transport from 'winston-transport';

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
      format.timestamp(),
      format.json(),
      format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      })
    ),
    transports: loggerTransports,
  });

  return loggerInstance;
};
