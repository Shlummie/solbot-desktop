import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { configSchema, defaultConfig, type AppConfig } from '@shared/config';
import { getAppDirectories } from './paths';
import { logger } from './logger';

let cachedConfig: AppConfig | undefined;

const loadFromDisk = (): AppConfig => {
  const { configPath, legacyConfigPath } = getAppDirectories();
  if (!existsSync(configPath)) {
    if (legacyConfigPath && existsSync(legacyConfigPath)) {
      logger.info('Migrating legacy config to project root config.json');
      const legacyRaw = readFileSync(legacyConfigPath, 'utf-8');
      writeFileSync(configPath, legacyRaw, 'utf-8');
      const legacyParsed = JSON.parse(legacyRaw);
      const legacyResult = configSchema.safeParse(legacyParsed);
      if (legacyResult.success) {
        return legacyResult.data;
      }
      logger.warn({ issues: legacyResult.error.issues }, 'Legacy config invalid, writing defaults');
      writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
      return defaultConfig;
    }
    logger.info('Config file missing, writing defaults');
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }

  const raw = readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw);
  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    logger.error({ issues: result.error.issues }, 'Invalid config, reverting to defaults');
    writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    return defaultConfig;
  }
  return result.data;
};

export const getConfig = (): AppConfig => {
  if (!cachedConfig) {
    cachedConfig = loadFromDisk();
  }
  return cachedConfig;
};

export const saveConfig = (config: AppConfig) => {
  const parsed = configSchema.parse(config);
  const { configPath } = getAppDirectories();
  writeFileSync(configPath, JSON.stringify(parsed, null, 2), 'utf-8');
  cachedConfig = parsed;
  logger.info('Configuration saved');
};

