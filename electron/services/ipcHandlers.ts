import { ipcMain, BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { getConfig, saveConfig } from './configService';
import {
  createWallets,
  importWalletFromFile,
  importWalletFromSecret,
  importBulkWallets,
  exportWallet,
  exportAllSideWallets,
  listWallets,
  setWalletRole,
  removeWallet,
} from './walletService';
import { fundSideWallets, getFundingHistory } from './fundingService';
import { executeTrades, getTradeHistory } from './tradeService';
import { sweepSideWallets } from './sweepService';
import { getRpcHealth } from './rpcClient';
import {
  getAutomationConfig,
  saveAutomationConfig,
  getAutomationStatus,
  startAutomation,
  stopAutomation,
  toggleWalletAutomation,
  setAllWalletsAutomation,
} from './automationService';
import type { IpcPayloads } from '@shared/types/ipc';
import { logger } from './logger';
import { openFileDialog, saveFileDialog } from '../utils/dialogs';

const getBrowserWindowFromEvent = (event: IpcMainInvokeEvent): BrowserWindow | null => {
  const sender = event.sender;
  const baseWindow = typeof (sender as any).getOwnerBrowserWindow === 'function'
    ? (sender as any).getOwnerBrowserWindow()
    : undefined;
  if (baseWindow) {
    return baseWindow;
  }
  const hostWindow = BrowserWindow.fromWebContents(sender);
  return hostWindow ?? null;
};

type Handler<K extends keyof IpcPayloads> = (
  event: IpcMainInvokeEvent,
  payload: IpcPayloads[K],
) => Promise<unknown> | unknown;

const registerHandler = <K extends keyof IpcPayloads>(channel: K, handler: Handler<K>) => {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return await handler(event, payload as IpcPayloads[K]);
    } catch (error) {
      logger.error({ channel, error }, 'IPC handler error');
      throw error;
    }
  });
};

export const registerIpcHandlers = () => {
  registerHandler('config:load', () => getConfig());
  registerHandler('config:save', (_event, payload) => {
    saveConfig(payload as ReturnType<typeof getConfig>);
  });
  registerHandler('wallet:create', (_event, payload) =>
    createWallets(payload.count, payload.role ?? 'side'),
  );
  registerHandler('wallet:import-dialog', (event) =>
    openFileDialog(getBrowserWindowFromEvent(event) ?? undefined, [
      { name: 'Solana Keypair', extensions: ['json'] },
    ]),
  );
  registerHandler('wallet:import', (_event, payload) =>
    importWalletFromFile(payload.path, payload.role ?? 'side'),
  );
  registerHandler('wallet:import-secret', (_event, payload) =>
    importWalletFromSecret(payload.secret, payload.role ?? 'side'),
  );
  registerHandler('wallet:import-bulk', (_event, payload) =>
    importBulkWallets(payload.path, payload.role ?? 'side'),
  );
  registerHandler('wallet:export-dialog', (event) =>
    saveFileDialog(getBrowserWindowFromEvent(event) ?? undefined, [
      { name: 'Solana Keypair', extensions: ['json'] },
    ]),
  );
  registerHandler('wallet:export', (_event, payload) =>
    exportWallet(payload.publicKey, payload.destination),
  );
  registerHandler('wallet:export-all-dialog', (event) =>
    saveFileDialog(getBrowserWindowFromEvent(event) ?? undefined, [
      { name: 'Wallet Backup', extensions: ['json'] },
    ]),
  );
  registerHandler('wallet:export-all', (_event, payload) =>
    exportAllSideWallets(payload.destination),
  );
  registerHandler('wallet:list', () => listWallets());
  registerHandler('wallet:tag', (_event, payload) =>
    setWalletRole(payload.publicKey, payload.role),
  );
  registerHandler('wallet:remove', (_event, payload) => removeWallet(payload.publicKey));
  registerHandler('wallet:fund', (_event, payload) => fundSideWallets(payload?.targetKeys ?? undefined));
  registerHandler('wallet:trade', (_event, payload) => {
    const options: { targetKeys?: string[]; customSol?: number; sellPercent?: number } = {};
    if (payload?.targetKeys && payload.targetKeys.length > 0) {
      options.targetKeys = payload.targetKeys;
    }
    if (typeof payload?.customSol === 'number') {
      options.customSol = payload.customSol;
    }
    if (typeof payload?.sellPercent === 'number') {
      options.sellPercent = payload.sellPercent;
    }
    return executeTrades(payload?.tokenMint ?? '', payload?.side ?? 'buy', options);
  });
  registerHandler('wallet:sweep', (_event, payload) => sweepSideWallets(payload));
  registerHandler('rpc:health', () => ({ collectedAt: new Date().toISOString(), endpoints: getRpcHealth() }));
  registerHandler('trade:history', () => getTradeHistory());
  registerHandler('funding:history', () => getFundingHistory());

  // Automation handlers
  registerHandler('automation:get-config', () => getAutomationConfig());
  registerHandler('automation:save-config', (_event, payload) => saveAutomationConfig(payload));
  registerHandler('automation:get-status', () => getAutomationStatus());
  registerHandler('automation:start', (_event, payload) => startAutomation(payload.mint));
  registerHandler('automation:stop', () => stopAutomation());
  registerHandler('automation:toggle-wallet', (_event, payload) => 
    toggleWalletAutomation(payload.publicKey, payload.enabled)
  );
  registerHandler('automation:set-all-wallets', (_event, payload) => 
    setAllWalletsAutomation(payload.enabled)
  );
};
