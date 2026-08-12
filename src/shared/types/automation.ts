export type AutomationConfig = {
  enabled: boolean;
  // Interval between trades (ms)
  intervalMs: {
    min: number;
    max: number;
  };
  // Buy/sell ratio (0-100, percentage chance of buy vs sell)
  buyPercentage: number;
  // SOL amount for buys
  buySol: {
    min: number;
    max: number;
  };
  // Sell percentage of holdings
  sellPercent: {
    min: number;
    max: number;
  };
  // Wallets enabled for automation (public keys)
  enabledWallets: string[];
};

export type AutomationStatus = {
  running: boolean;
  totalTrades: number;
  successfulTrades: number;
  failedTrades: number;
  lastTradeTime: string | null;
  lastTradeWallet: string | null;
  lastTradeSide: 'buy' | 'sell' | null;
};

export const defaultAutomationConfig: AutomationConfig = {
  enabled: false,
  intervalMs: {
    min: 10000,  // 10 seconds
    max: 60000,  // 60 seconds
  },
  buyPercentage: 50, // 50% buy, 50% sell
  buySol: {
    min: 0.01,
    max: 0.05,
  },
  sellPercent: {
    min: 10,
    max: 50,
  },
  enabledWallets: [],
};

