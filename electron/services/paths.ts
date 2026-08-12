import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { app } from 'electron';

export const ensureDirectory = (path: string) => {
  if (!existsSync(path)) {
    mkdirSync(path, { recursive: true });
  }
};

export const getAppDirectories = () => {
  const base = app.getPath('userData');
  const walletsDir = join(base, 'wallets');
  const legacyConfigPath = join(base, 'config', 'solbot.config.json');
  const configPath = join(process.cwd(), 'config.json');
  const configDir = dirname(configPath);

  [configDir, walletsDir].forEach(ensureDirectory);

  return {
    base,
    configDir,
    walletsDir,
    configPath,
    legacyConfigPath,
  };
};

