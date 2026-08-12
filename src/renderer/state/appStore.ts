import { create } from 'zustand';
import { defaultConfig, type AppConfig } from '@shared/config';
import type { WalletSummary, WalletRole } from '@shared/types/wallet';
import type { RpcHealthSnapshot } from '@shared/types/scheduler';
import type { TradeResult } from '@shared/types/trade';
import type { FundingResult } from '@shared/types/funding';
import type { AutomationConfig, AutomationStatus } from '@shared/types/automation';
import { defaultAutomationConfig } from '@shared/types/automation';

type AppState = {
  config: AppConfig;
  wallets: WalletSummary[];
  activityLog: string[];
  isLoadingWallets: boolean;
  selectedRole: WalletRole;
  showCreateModal: boolean;
  showImportModal: boolean;
  showExportModal: boolean;
  toasts: Toast[];
  rpcHealth: RpcHealthSnapshot | null;
  rpcHealthHistory: RpcHealthSnapshot[];
  tradeHistory: TradeResult[];
  fundingHistory: FundingResult[];
  automationConfig: AutomationConfig;
  automationStatus: AutomationStatus;
  setConfig: (config: AppConfig | ((prev: AppConfig) => AppConfig)) => void;
  setWallets: (wallets: WalletSummary[]) => void;
  appendLog: (entry: string) => void;
  clearLogs: () => void;
  setLoadingWallets: (loading: boolean) => void;
  setSelectedRole: (role: WalletRole) => void;
  setShowCreateModal: (show: boolean) => void;
  setShowImportModal: (show: boolean) => void;
  setShowExportModal: (show: boolean) => void;
  pushToast: (toast: Omit<Toast, 'id'>) => void;
  dismissToast: (id: number) => void;
  setRpcHealth: (snapshot: RpcHealthSnapshot | null) => void;
  pushRpcHealthHistory: (snapshot: RpcHealthSnapshot) => void;
  clearRpcHealthHistory: () => void;
  setTradeHistory: (history: TradeResult[]) => void;
  setFundingHistory: (history: FundingResult[]) => void;
  setAutomationConfig: (config: AutomationConfig) => void;
  setAutomationStatus: (status: AutomationStatus) => void;
};

export type Toast = {
  id: number;
  type: 'info' | 'success' | 'error';
  message: string;
};

export const useAppStore = create<AppState>((set) => ({
  config: defaultConfig,
  wallets: [],
  activityLog: [],
  isLoadingWallets: false,
  selectedRole: 'side',
  showCreateModal: false,
  showImportModal: false,
  showExportModal: false,
  toasts: [],
  rpcHealth: null,
  rpcHealthHistory: [],
  tradeHistory: [],
  fundingHistory: [],
  automationConfig: defaultAutomationConfig,
  automationStatus: {
    running: false,
    totalTrades: 0,
    successfulTrades: 0,
    failedTrades: 0,
    lastTradeTime: null,
    lastTradeWallet: null,
    lastTradeSide: null,
  },
  setConfig: (config) =>
    set((state) => ({ config: typeof config === 'function' ? config(state.config) : config })),
  setWallets: (wallets) => set({ wallets }),
  appendLog: (entry) =>
    set((state) => {
      const timestamp = new Date().toISOString();
      const message = `[${timestamp}] ${entry}`;
      return {
        activityLog: [message, ...state.activityLog].slice(0, 500),
      };
    }),
  clearLogs: () => set({ activityLog: [] }),
  setLoadingWallets: (loading) => set({ isLoadingWallets: loading }),
  setSelectedRole: (role) => set({ selectedRole: role }),
  setShowCreateModal: (show) => set({ showCreateModal: show }),
  setShowImportModal: (show) => set({ showImportModal: show }),
  setShowExportModal: (show) => set({ showExportModal: show }),
  pushToast: (toast) =>
    set((state) => ({ toasts: [{ id: Date.now() + Math.random(), ...toast }, ...state.toasts].slice(0, 6) })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
  setRpcHealth: (snapshot) => set({ rpcHealth: snapshot }),
  pushRpcHealthHistory: (snapshot) =>
    set((state) => ({ rpcHealthHistory: [snapshot, ...state.rpcHealthHistory].slice(0, 10) })),
  clearRpcHealthHistory: () => set({ rpcHealthHistory: [] }),
  setTradeHistory: (history) => set({ tradeHistory: history }),
  setFundingHistory: (history) => set({ fundingHistory: history }),
  setAutomationConfig: (config) => set({ automationConfig: config }),
  setAutomationStatus: (status) => set({ automationStatus: status }),
}));
