import { app, BrowserWindow, ipcMain } from 'electron';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { registerIpcHandlers } from './services/ipcHandlers';
import { getAppDirectories } from './services/paths';
import { logger } from './services/logger';

const moduleFilename = fileURLToPath(import.meta.url);
const moduleDirname = path.dirname(moduleFilename);
const __filename = moduleFilename;
const __dirname = moduleDirname;

if (typeof (globalThis as { __filename?: string }).__filename === 'undefined') {
  (globalThis as { __filename: string }).__filename = moduleFilename;
}
if (typeof (globalThis as { __dirname?: string }).__dirname === 'undefined') {
  (globalThis as { __dirname: string }).__dirname = moduleDirname;
}

const isDev = process.env.NODE_ENV === 'development';

const serializeError = (value: unknown) => {
  if (value instanceof Error) {
    return { message: value.message, stack: value.stack, name: value.name };
  }
  if (typeof value === 'object' && value !== null) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return { message: 'Non-serializable error object' };
    }
  }
  return { message: String(value) };
};

const pingRenderer = (url: string): Promise<number> => {
  return new Promise((resolve, reject) => {
    const base = new URL(url);
    const probe = new URL(base.href);
    if (!probe.pathname.endsWith('/')) {
      probe.pathname = `${probe.pathname}/`;
    }
    probe.pathname = `${probe.pathname.replace(/\/+$/, '/') }index.html`;

    const client = probe.protocol === 'https:' ? https : http;
    const request = client.request(
      {
        method: 'GET',
        hostname: probe.hostname,
        port: probe.port,
        path: probe.pathname,
        timeout: 2000,
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      },
    );
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy(new Error('Renderer ping timeout'));
    });
    request.end();
  });
};

const waitForRenderer = async (url: string, retries = 60, delayMs = 300) => {
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const status = await pingRenderer(url);
      if (status >= 200 && status < 300) {
        logger.debug({ url, status, attempt }, 'Renderer dev server responded with index.html');
        return;
      }
      logger.warn({ url, status, attempt }, 'Renderer dev server not ready');
    } catch (error) {
      logger.debug({ url, attempt, error: serializeError(error) }, 'Renderer ping failed');
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  logger.warn({ url }, 'Renderer dev server did not return index.html; proceeding anyway');
};

const createWindow = async () => {
  getAppDirectories();
  logger.info({ isDev }, 'Creating application window');
  const window = new BrowserWindow({
    width: 1280,
    height: 768,
    webPreferences: {
      preload: path.join(moduleDirname, '../preload/index.js'),
    },
  });

  if (isDev) {
    window.webContents.openDevTools({ mode: 'detach' });
  }

  const loadUrl = async () => {
    if (isDev) {
      const devServerUrl = process.env.VITE_DEV_SERVER_URL ?? `http://localhost:${process.env.VITE_DEV_SERVER_PORT ?? 5173}`;
      await waitForRenderer(devServerUrl);
      logger.debug({ devServerUrl }, 'Loading renderer in development mode');
      await window.loadURL(devServerUrl);
    } else {
      window.removeMenu();
      await window.loadURL(pathToFileURL(path.join(moduleDirname, '../../dist/index.html')).toString());
    }
  };

  await loadUrl().catch((error) => {
    const details = serializeError(error);
    logger.error({ error: details }, 'Failed to load renderer, closing window');
    console.error('Renderer load failure:', error);
    window.close();
    throw error;
  });

  return window;
};

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.whenReady().then(() => {
  ipcMain.setMaxListeners(50);
  registerIpcHandlers();
  logger.info('IPC handlers registered');
  createWindow().catch((error) => {
    const details = serializeError(error);
    logger.error({ error: details }, 'Failed to create application window');
    console.error('Window creation failure:', error);
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      logger.info('Recreating window after activate');
      createWindow().catch((error) => {
        const details = serializeError(error);
        logger.error({ error: details }, 'Failed to recreate window on activate');
        console.error('Window recreation failure:', error);
      });
    }
  });
});

process.on('uncaughtException', (error) => {
  logger.error({ error: serializeError(error) }, 'Uncaught exception in main process');
  console.error('Uncaught exception:', error);
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason: serializeError(reason) }, 'Unhandled rejection in main process');
  console.error('Unhandled rejection:', reason);
});
