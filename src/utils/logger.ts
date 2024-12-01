// src/utils/logger.ts

import winston, { format, transports, Logger } from 'winston';
import { TransformableInfo } from 'logform';

export const logger: Logger = winston.createLogger({
  level: 'info',
  format: format.combine(
    format.colorize(),
    format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss',
    }),
    format.printf((info: TransformableInfo) => {
      return `${info.timestamp} [${info.level}]: ${info.message}`;
    })
  ),
  transports: [new transports.Console()],
});
