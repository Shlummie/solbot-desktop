export type TokenSweepResult = {
  mint: string;
  amount: string;
};

export type SweepResult = {
  wallet: string;
  solLamports?: number;
  tokens?: TokenSweepResult[];
  signature?: string;
  error?: string;
};

export type TokenSweepSelection = {
  mint: string;
  selected: boolean;
};

export type SweepRequest = {
  includeTokens: string[];
  includeSol?: boolean;
  minRentLamports?: number;
};
