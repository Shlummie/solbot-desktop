export type TradeResult = {
  wallet: string;
  mint: string;
  side: 'buy' | 'sell';
  lamports: number;
  signature?: string;
  error?: string;
  timestamp: string;
};
