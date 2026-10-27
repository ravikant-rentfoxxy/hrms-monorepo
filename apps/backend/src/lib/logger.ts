import path from 'path';
import pino from 'pino';
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { isProd } from '../config/env';

/**
 * App logger with pino-style calls everywhere:
 *   logger.info('message')
 *   logger.warn({ key }, 'message')
 *   logger.error(err, 'message')
 *
 * Production: pino JSON on stdout. Development: winston — colourised console
 * plus daily files in apps/backend/logs (app-YYYY-MM-DD.log, errors in
 * error-YYYY-MM-DD.log), kept for 5 days.
 */
type LogFn = {
  (msg: string): void;
  (obj: unknown, msg?: string): void;
};

export interface AppLogger {
  /** Minimum level written (e.g. seeds set 'warn' to stay quiet). */
  level: string;
  debug: LogFn;
  info: LogFn;
  warn: LogFn;
  error: LogFn;
}

const LOG_DIR = path.resolve(__dirname, '../../logs');
const RETENTION = '5d';

function errorFields(err: Error): Record<string, unknown> {
  return { message: err.message, stack: err.stack, ...(err as unknown as Record<string, unknown>) };
}

/** Errors (top-level or under `err`) keep their message and stack in the output. */
function normalise(obj: unknown): Record<string, unknown> {
  if (obj instanceof Error) return { err: errorFields(obj) };
  if (obj && typeof obj === 'object') {
    const rec = obj as Record<string, unknown>;
    return rec.err instanceof Error ? { ...rec, err: errorFields(rec.err) } : rec;
  }
  return { value: obj };
}

function createWinstonLogger(): AppLogger {
  const timestamp = winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' });
  const line = winston.format.printf(({ level, message, timestamp: ts, ...meta }) => {
    const { err, ...rest } = meta as { err?: { stack?: string } } & Record<string, unknown>;
    const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
    return `${String(ts)} ${level} ${String(message)}${extra}${err?.stack ? `\n${err.stack}` : ''}`;
  });
  const file = (name: string, level?: string) =>
    new DailyRotateFile({
      dirname: LOG_DIR,
      filename: `${name}-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles: RETENTION,
      level,
      format: winston.format.combine(timestamp, line),
    });

  const w = winston.createLogger({
    level: 'debug',
    transports: [
      new winston.transports.Console({ format: winston.format.combine(winston.format.colorize(), timestamp, line) }),
      file('app'),
      file('error', 'error'),
    ],
  });

  const fn =
    (level: 'debug' | 'info' | 'warn' | 'error'): LogFn =>
    (objOrMsg: unknown, msg?: string) => {
      if (typeof objOrMsg === 'string') w.log(level, objOrMsg);
      else w.log(level, msg ?? (objOrMsg instanceof Error ? objOrMsg.message : ''), normalise(objOrMsg));
    };
  return {
    get level() {
      return w.level;
    },
    set level(value: string) {
      w.level = value;
    },
    debug: fn('debug'),
    info: fn('info'),
    warn: fn('warn'),
    error: fn('error'),
  };
}

export const logger: AppLogger = isProd ? pino({ level: 'info' }) : createWinstonLogger();
