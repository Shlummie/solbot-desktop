import { EventEmitter } from 'node:events';
import { BrowserWindow } from 'electron';
import { logger } from './logger';

type LogMessage = {
  level: string;
  time: number;
  msg: string;
  [key: string]: unknown;
};

class LogStream extends EventEmitter {
  publish(entry: LogMessage) {
    this.emit('log', entry);
    BrowserWindow.getAllWindows().forEach((window) => {
      window.webContents.send('logs:stream', entry);
    });
  }
}

export const logStream = new LogStream();

const originalInfo = logger.info.bind(logger);
const originalError = logger.error.bind(logger);
const originalWarn = logger.warn.bind(logger);
const originalDebug = logger.debug.bind(logger);

const serializeArgs = (args: unknown[]): string =>
  args
    .map((arg) => {
      if (typeof arg === 'string') return arg;
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    })
    .join(' ');

logger.info = (...args: Parameters<typeof originalInfo>) => {
  originalInfo(...args);
  logStream.publish({ level: 'info', time: Date.now(), msg: serializeArgs(args) });
};

logger.error = (...args: Parameters<typeof originalError>) => {
  originalError(...args);
  logStream.publish({ level: 'error', time: Date.now(), msg: serializeArgs(args) });
};

logger.warn = (...args: Parameters<typeof originalWarn>) => {
  originalWarn(...args);
  logStream.publish({ level: 'warn', time: Date.now(), msg: serializeArgs(args) });
};

logger.debug = (...args: Parameters<typeof originalDebug>) => {
  originalDebug(...args);
  logStream.publish({ level: 'debug', time: Date.now(), msg: serializeArgs(args) });
};
