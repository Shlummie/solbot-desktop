export type WalletRole = 'main' | 'side';

export type WalletMetadata = {
  publicKey: string;
  role: WalletRole;
  tag?: string;
};

export type WalletSummary = WalletMetadata & {
  balanceLamports?: number;
};

