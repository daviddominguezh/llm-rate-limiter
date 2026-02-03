import { existsSync, mkdirSync } from 'node:fs';
import winston from 'winston';

import { EMPTY_LENGTH, LOG_DIR, LOG_FILE_COMBINED, LOG_FILE_ERROR } from './constants.js';

if (!existsSync(LOG_DIR)) mkdirSync(LOG_DIR, { recursive: true });

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
      filename: LOG_FILE_ERROR,
      level: 'error',
    }),
    new winston.transports.File({
      filename: LOG_FILE_COMBINED,
    }),
  ],
});
