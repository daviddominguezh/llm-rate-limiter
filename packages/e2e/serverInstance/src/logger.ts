import { existsSync, mkdirSync } from 'node:fs';
import winston from 'winston';

import { DEFAULT_PRIMARY_PORT, EMPTY_LENGTH, LOG_DIR } from './constants.js';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

// Use PORT to differentiate log files per instance
const port = process.env.PORT ?? String(DEFAULT_PRIMARY_PORT);
const logFileError = `${LOG_DIR}/error-${port}.log`;
const logFileCombined = `${LOG_DIR}/combined-${port}.log`;

const { format } = winston;
const { combine, timestamp, printf, colorize } = format;

const logFormat = printf(({ level, message, timestamp: ts, ...meta }) => {
  const metaStr = Object.keys(meta).length > EMPTY_LENGTH ? ` ${JSON.stringify(meta)}` : '';
  const timestampStr = typeof ts === 'string' ? ts : String(ts);
  const messageStr = typeof message === 'string' ? message : String(message);
  return `${timestampStr} [${level}] ${messageStr}${metaStr}`;
});

const timestampFormat = { format: 'YYYY-MM-DD HH:mm:ss.SSS' };

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL ?? 'info',
  format: combine(timestamp(timestampFormat), logFormat),
  transports: [
    new winston.transports.Console({
      format: combine(colorize(), timestamp(timestampFormat), logFormat),
    }),
    new winston.transports.File({
      filename: logFileError,
      level: 'error',
    }),
    new winston.transports.File({
      filename: logFileCombined,
    }),
  ],
});
