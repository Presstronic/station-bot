import { createLogger, format, transports } from 'winston';
import { ElasticsearchTransport } from 'winston-elasticsearch';

export const getLogger = () => {
  const logLevel = process.env.LOG_LEVEL || 'info'; // Read environment variables dynamically
  const esNode = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';

  const esTransport = new ElasticsearchTransport({
    level: logLevel,
    clientOpts: { node: esNode },
  });

  return createLogger({
    level: logLevel,
    format: format.combine(
      format.timestamp(),
      format.json(),
      format.printf(({ timestamp, level, message }) => {
        return `[${timestamp}] ${level.toUpperCase()}: ${message}`;
      })
    ),
    transports: [
      new transports.Console(),
      new transports.File({ filename: './logs/app.log' }),
      esTransport,
    ],
  });
};
