import pino, { multistream, stdTimeFunctions, type DestinationStream, type Level, type Logger as PinoLogger } from 'pino';
import { mkdirSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';
import { Transform } from 'node:stream';
import { app } from 'electron';
import type { AppConfig } from '@shared/config';

type LoggingConfig = AppConfig['logging'];

type LevelName = Level | 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

type StreamWithTearDown = DestinationStream & { teardown?: () => void };

const LEVEL_LABEL: Record<number, string> = {
  10: 'TRACE',
  20: 'DEBUG',
  30: 'INFO',
  40: 'WARN',
  50: 'ERROR',
  60: 'FATAL',
};

class JsonToTextStream extends Transform {
  constructor() {
    super({ decodeStrings: false });
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: (error?: Error | null) => void) {
    try {
      const asString = typeof chunk === 'string' ? chunk : String(chunk);
      const record = JSON.parse(asString) as Record<string, unknown>;
      const timestamp = typeof record.time === 'number' ? new Date(record.time).toISOString() : new Date().toISOString();
      const levelNumber = typeof record.level === 'number' ? record.level : 30;
      const level = LEVEL_LABEL[levelNumber] ?? String(record.level ?? 'INFO').toUpperCase();
      const msg = typeof record.msg === 'string' ? record.msg : '';
      const contextEntries = Object.entries(record)
        .filter(([key]) => !['msg', 'time', 'level'].includes(key))
        .map(([key, value]) => `${key}=${formatValue(value)}`);
      const context = contextEntries.length ? ` ${contextEntries.join(' ')}` : '';
      this.push(`[${timestamp}] ${level.padEnd(5)} ${msg}${context}\n`);
    } catch (error) {
      this.push(String(chunk));
      this.push('\n');
    }
    callback();
  }
}

const formatValue = (value: unknown) => {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value === 'string') {
    return value.includes(' ') ? JSON.stringify(value) : value;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const ensureDir = (filePath: string) => {
  const directory = dirname(filePath);
  mkdirSync(directory, { recursive: true });
};

const buildFilePath = (pathLike: string): string => {
  if (isAbsolute(pathLike)) {
    return pathLike;
  }
  const base = app.getPath('userData');
  return join(base, pathLike);
};

const createConsoleStream = (json: boolean): StreamWithTearDown => {
  if (json) {
    const destination = pino.destination({ fd: 1, sync: false });
    return destination as StreamWithTearDown;
  }
  const pretty = new JsonToTextStream();
  pretty.pipe(process.stdout);
  return Object.assign(pretty, {
    teardown: () => {
      pretty.unpipe(process.stdout);
      pretty.end();
    },
  });
};

const createFileStream = (filePath: string): StreamWithTearDown => {
  ensureDir(filePath);
  const destination = pino.destination({ dest: filePath, sync: false, mkdir: true });
  return Object.assign(destination as StreamWithTearDown, {
    teardown: () => {
      destination.end?.();
    },
  });
};

const defaultLevel = (process.env.SOLBOT_LOG_LEVEL ?? 'info') as LevelName;

const createLoggerInstance = (logging?: LoggingConfig): PinoLogger => {
  const jsonOutput = logging?.json ?? true;
  const level = (logging?.level ?? defaultLevel) as LevelName;
  activeStreams.forEach((stream) => stream.teardown?.());
  activeStreams.length = 0;

  const consoleStream = createConsoleStream(jsonOutput);
  activeStreams.push(consoleStream);
  const targets = [
    { level, stream: consoleStream as DestinationStream },
  ];

  if (logging?.file) {
    const filePath = buildFilePath(logging.file);
    const fileStream = createFileStream(filePath);
    activeStreams.push(fileStream);
    targets.push({ level, stream: fileStream as DestinationStream });
  }

  return pino(
    {
      level,
      messageKey: 'msg',
      timestamp: stdTimeFunctions.isoTime,
      base: { service: 'solbot' },
      formatters: {
        level: (label) => ({ level: label }),
      },
    },
    multistream(targets),
  );
};

const activeStreams: StreamWithTearDown[] = [];

let instance: PinoLogger = createLoggerInstance();

export const logger: PinoLogger = new Proxy({} as PinoLogger, {
  get(_target, property, receiver) {
    const value = Reflect.get(instance, property, receiver);
    if (typeof value === 'function') {
      return value.bind(instance);
    }
    return value;
  },
  set(_target, property, value, receiver) {
    Reflect.set(instance, property, value, receiver);
    return true;
  },
});

export const configureLogger = (config: AppConfig) => {
  instance = createLoggerInstance(config.logging);
};

export const getLoggerInstance = () => instance;
