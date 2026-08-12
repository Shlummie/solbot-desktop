import type { WalletRole } from './wallet';
import type { SweepRequest } from './sweep';
import type { AutomationConfig } from './automation';
export type { SweepRequest };

export type IpcChannel =
  | 'config:load'
  | 'config:save'
  | 'wallet:create'
  | 'wallet:import'
  | 'wallet:import-secret'
  | 'wallet:import-bulk'
  | 'wallet:import-dialog'
  | 'wallet:export'
  | 'wallet:export-dialog'
  | 'wallet:export-all'
  | 'wallet:export-all-dialog'
  | 'wallet:remove'
  | 'wallet:list'
  | 'wallet:tag'
  | 'wallet:fund'
  | 'wallet:trade'
  | 'wallet:sweep'
  | 'logs:stream'
  | 'automation:get-config'
  | 'automation:save-config'
  | 'automation:get-status'
  | 'automation:start'
  | 'automation:stop'
  | 'automation:toggle-wallet'
  | 'automation:set-all-wallets';

export type IpcPayloads = {
  'config:load': void;
  'config:save': unknown;
  'wallet:create': { count: number; role?: WalletRole };
  'wallet:import': { path: string; role?: WalletRole };
  'wallet:import-secret': { secret: string | number[]; role?: WalletRole };
  'wallet:import-bulk': { path: string; role?: WalletRole };
  'wallet:import-dialog': void;
  'wallet:export': { publicKey: string; destination: string };
  'wallet:export-dialog': void;
  'wallet:export-all': { destination: string };
  'wallet:export-all-dialog': void;
  'wallet:remove': { publicKey: string };
  'wallet:list': void;
  'wallet:tag': { publicKey: string; role: WalletRole };
  'wallet:fund': { targetKeys?: string[] };
  'wallet:trade': {
    tokenMint: string;
    side: 'buy' | 'sell';
    targetKeys?: string[];
    customSol?: number;
    sellPercent?: number;
  };
  'wallet:sweep': SweepRequest;
  'rpc:health': void;
  'trade:history': void;
  'funding:history': void;
  'logs:stream': { level: 'info' | 'debug' };
  'automation:get-config': void;
  'automation:save-config': AutomationConfig;
  'automation:get-status': void;
  'automation:start': { mint: string };
  'automation:stop': void;
  'automation:toggle-wallet': { publicKey: string; enabled: boolean };
  'automation:set-all-wallets': { enabled: boolean };
};
