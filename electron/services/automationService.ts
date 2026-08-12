import { BrowserWindow } from 'electron';
import { writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { getAppDirectories } from './paths';
import { logger } from './logger';
import { getSideWallets } from './walletService';
import { executeTrades } from './tradeService';
import { randomInRange, randomIntInRange } from '@shared/utils/random';
import type { AutomationConfig, AutomationStatus } from '@shared/types/automation';
import { defaultAutomationConfig } from '@shared/types/automation';

let automationConfig: AutomationConfig = { ...defaultAutomationConfig };
let automationStatus: AutomationStatus = {
  running: false,
  totalTrades: 0,
  successfulTrades: 0,
  failedTrades: 0,
  lastTradeTime: null,
  lastTradeWallet: null,
  lastTradeSide: null,
};

let automationTimer: NodeJS.Timeout | null = null;
let automationImmediate: NodeJS.Immediate | null = null;
let currentMint: string = '';

// Throttle status updates to prevent UI thrashing
let lastStatusUpdate = 0;
const STATUS_UPDATE_THROTTLE_MS = 500;

const getConfigPath = () => join(getAppDirectories().walletsDir, '../automation.json');

export const loadAutomationConfig = (): AutomationConfig => {
  const path = getConfigPath();
  try {
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as Partial<AutomationConfig>;
      // Deep merge to preserve nested objects
      automationConfig = {
        ...defaultAutomationConfig,
        ...data,
        intervalMs: { ...defaultAutomationConfig.intervalMs, ...data.intervalMs },
        buySol: { ...defaultAutomationConfig.buySol, ...data.buySol },
        sellPercent: { ...defaultAutomationConfig.sellPercent, ...data.sellPercent },
      };
      logger.info({
        buyRange: `${automationConfig.buySol.min}-${automationConfig.buySol.max} SOL`,
        sellRange: `${automationConfig.sellPercent.min}-${automationConfig.sellPercent.max}%`,
        intervalRange: `${(automationConfig.intervalMs.min / 1000).toFixed(1)}-${(automationConfig.intervalMs.max / 1000).toFixed(1)}s`,
      }, 'Loaded automation config');
    }
  } catch (error) {
    logger.warn({ error }, 'Failed loading automation config, using defaults');
  }
  return automationConfig;
};

export const saveAutomationConfig = (config: AutomationConfig): void => {
  const path = getConfigPath();
  automationConfig = config;
  writeFileSync(path, JSON.stringify(config, null, 2), 'utf-8');
  logger.info({
    buyRange: `${config.buySol.min}-${config.buySol.max} SOL`,
    sellRange: `${config.sellPercent.min}-${config.sellPercent.max}%`,
    intervalRange: `${(config.intervalMs.min / 1000).toFixed(1)}-${(config.intervalMs.max / 1000).toFixed(1)}s`,
    buyPercentage: `${config.buyPercentage}%`,
    enabledWallets: config.enabledWallets.length,
  }, 'Automation config saved');
};

export const getAutomationConfig = (): AutomationConfig => automationConfig;
export const getAutomationStatus = (): AutomationStatus => automationStatus;

const notifyRenderer = (event: string, data: unknown, force = false) => {
  const now = Date.now();
  // Throttle status updates to prevent UI thrashing
  if (!force && event === 'automation:status' && now - lastStatusUpdate < STATUS_UPDATE_THROTTLE_MS) {
    return;
  }
  lastStatusUpdate = now;
  
  // Use setImmediate to yield to the event loop before sending
  setImmediate(() => {
    const windows = BrowserWindow.getAllWindows();
    for (const win of windows) {
      if (!win.isDestroyed()) {
        win.webContents.send(event, data);
      }
    }
  });
};

const executeRandomTrade = async () => {
  if (!automationStatus.running) {
    return;
  }

  // Re-read config to get latest values
  const currentConfig = automationConfig;
  
  const enabledWallets = currentConfig.enabledWallets.filter((pk) => {
    const sideWallets = getSideWallets();
    return sideWallets.some((w) => w.publicKey === pk);
  });

  if (enabledWallets.length === 0) {
    logger.warn('No enabled wallets for automation');
    scheduleNextTrade();
    return;
  }

  // Pick random wallet
  const walletIndex = randomIntInRange(0, enabledWallets.length - 1);
  const wallet = enabledWallets[walletIndex];

  if (!wallet) {
    scheduleNextTrade();
    return;
  }

  // Decide buy or sell based on ratio
  const roll = Math.random() * 100;
  const side: 'buy' | 'sell' = roll < currentConfig.buyPercentage ? 'buy' : 'sell';

  // Calculate amount from automation config (not trade config)
  let customSol: number | undefined;
  let sellPercent: number | undefined;

  if (side === 'buy') {
    // Use automation-specific buy range
    const minSol = currentConfig.buySol.min;
    const maxSol = currentConfig.buySol.max;
    customSol = randomInRange(minSol, maxSol);
    logger.info({
      wallet: wallet.slice(0, 8) + '...',
      side,
      customSol: customSol.toFixed(4),
      range: `${minSol}-${maxSol} SOL`,
      mint: currentMint.slice(0, 8) + '...',
    }, 'Automation executing BUY');
  } else {
    // Use automation-specific sell range
    const minPercent = currentConfig.sellPercent.min;
    const maxPercent = currentConfig.sellPercent.max;
    sellPercent = randomIntInRange(minPercent, maxPercent);
    logger.info({
      wallet: wallet.slice(0, 8) + '...',
      side,
      sellPercent: `${sellPercent}%`,
      range: `${minPercent}-${maxPercent}%`,
      mint: currentMint.slice(0, 8) + '...',
    }, 'Automation executing SELL');
  }

  // Log the exact values being passed to executeTrades
  logger.debug({
    wallet: wallet.slice(0, 8) + '...',
    side,
    customSol,
    sellPercent,
    configBuySol: currentConfig.buySol,
    configSellPercent: currentConfig.sellPercent,
  }, 'Passing values to executeTrades');

  try {
    const signatures = await executeTrades(currentMint, side, {
      targetKeys: [wallet],
      ...(customSol === undefined ? {} : { customSol }),
      ...(sellPercent === undefined ? {} : { sellPercent }),
    });

    automationStatus.totalTrades += 1;
    if (signatures.length > 0 && !signatures[0]?.startsWith('skip-')) {
      automationStatus.successfulTrades += 1;
    } else {
      automationStatus.failedTrades += 1;
    }
    automationStatus.lastTradeTime = new Date().toISOString();
    automationStatus.lastTradeWallet = wallet;
    automationStatus.lastTradeSide = side;

    logger.info({ 
      wallet: wallet.slice(0, 8) + '...', 
      side, 
      signatures: signatures.map(s => s.slice(0, 16) + '...'),
      customSol: customSol?.toFixed(4),
      sellPercent: sellPercent ? `${sellPercent}%` : undefined,
    }, 'Automation trade completed');
    
    // Force status update after trade completes
    notifyRenderer('automation:status', automationStatus, true);
  } catch (error) {
    automationStatus.totalTrades += 1;
    automationStatus.failedTrades += 1;
    automationStatus.lastTradeTime = new Date().toISOString();
    automationStatus.lastTradeWallet = wallet;
    automationStatus.lastTradeSide = side;

    const errorDetails = error instanceof Error ? error.message : String(error);
    logger.error({ error: errorDetails, wallet: wallet.slice(0, 8) + '...', side }, 'Automation trade failed');
    notifyRenderer('automation:status', automationStatus, true);
  }

  // Yield to event loop before scheduling next trade
  setImmediate(() => {
    scheduleNextTrade();
  });
};

const scheduleNextTrade = () => {
  if (!automationStatus.running) {
    return;
  }

  const minMs = automationConfig.intervalMs.min;
  const maxMs = automationConfig.intervalMs.max;
  const delay = randomIntInRange(minMs, maxMs);
  
  logger.debug({ 
    delayMs: delay, 
    range: `${(minMs / 1000).toFixed(1)}-${(maxMs / 1000).toFixed(1)}s` 
  }, 'Scheduling next automation trade');
  
  automationTimer = setTimeout(() => {
    // Use setImmediate to allow the event loop to process other events
    automationImmediate = setImmediate(() => {
      void executeRandomTrade();
    });
  }, delay);
};

export const startAutomation = (mint: string): boolean => {
  if (automationStatus.running) {
    logger.warn('Automation already running');
    return false;
  }

  if (!mint || mint.trim() === '') {
    logger.error('No mint provided for automation');
    return false;
  }

  // Reload config from disk to ensure we have the latest values
  loadAutomationConfig();

  if (automationConfig.enabledWallets.length === 0) {
    logger.error('No wallets enabled for automation');
    return false;
  }

  // Validate ranges
  if (automationConfig.buySol.min <= 0 || automationConfig.buySol.max <= 0) {
    logger.error({ buySol: automationConfig.buySol }, 'Invalid buy SOL range');
    return false;
  }
  if (automationConfig.sellPercent.min <= 0 || automationConfig.sellPercent.max <= 0) {
    logger.error({ sellPercent: automationConfig.sellPercent }, 'Invalid sell percent range');
    return false;
  }

  currentMint = mint.trim();
  automationStatus = {
    running: true,
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    lastTradeTime: null,
    lastTradeWallet: null,
    lastTradeSide: null,
  };

  logger.info({ 
    mint: currentMint.slice(0, 8) + '...', 
    enabledWallets: automationConfig.enabledWallets.length,
    buyRange: `${automationConfig.buySol.min}-${automationConfig.buySol.max} SOL`,
    sellRange: `${automationConfig.sellPercent.min}-${automationConfig.sellPercent.max}%`,
    intervalRange: `${(automationConfig.intervalMs.min / 1000).toFixed(1)}-${(automationConfig.intervalMs.max / 1000).toFixed(1)}s`,
    buyPercentage: `${automationConfig.buyPercentage}%`,
  }, 'Starting automation with config');
  
  notifyRenderer('automation:status', automationStatus, true);

  // Start first trade after a brief delay to allow UI to update
  automationTimer = setTimeout(() => {
    automationImmediate = setImmediate(() => {
      void executeRandomTrade();
    });
  }, 100);

  return true;
};

export const stopAutomation = (): void => {
  if (automationTimer) {
    clearTimeout(automationTimer);
    automationTimer = null;
  }
  
  if (automationImmediate) {
    clearImmediate(automationImmediate);
    automationImmediate = null;
  }

  automationStatus.running = false;
  logger.info({ 
    totalTrades: automationStatus.totalTrades, 
    successful: automationStatus.successfulTrades,
    failed: automationStatus.failedTrades,
  }, 'Automation stopped');
  notifyRenderer('automation:status', automationStatus, true);
};

export const toggleWalletAutomation = (publicKey: string, enabled: boolean): void => {
  if (enabled) {
    if (!automationConfig.enabledWallets.includes(publicKey)) {
      automationConfig.enabledWallets.push(publicKey);
    }
  } else {
    automationConfig.enabledWallets = automationConfig.enabledWallets.filter((pk) => pk !== publicKey);
  }
  saveAutomationConfig(automationConfig);
};

export const setAllWalletsAutomation = (enabled: boolean): void => {
  if (enabled) {
    const sideWallets = getSideWallets();
    automationConfig.enabledWallets = sideWallets.map((w) => w.publicKey);
  } else {
    automationConfig.enabledWallets = [];
  }
  saveAutomationConfig(automationConfig);
};

// Load config on module init
loadAutomationConfig();

