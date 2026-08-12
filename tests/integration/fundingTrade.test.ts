import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

import * as fundingService from '../../electron/services/fundingService';
import * as tradeService from '../../electron/services/tradeService';
import * as configService from '../../electron/services/configService';
import { getSideWallets, getMainWallet, loadKeypair } from '../../electron/services/walletService';
import { setRandomSeed } from '@/shared/utils/random';

vi.mock('../../electron/services/walletService');
vi.mock('../../electron/services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  },
}));

const sendRawTransactionMock = vi.fn(async () => 'test-signature');

vi.mock('../../electron/services/rpcClient', () => ({
  withRpc: async (
    fn: (connection: {
      getMinimumBalanceForRentExemption: () => Promise<number>;
      getLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>;
      sendRawTransaction: typeof sendRawTransactionMock;
      sendTransaction: (transaction: unknown) => Promise<string>;
      getBalance: () => Promise<number>;
      getAccountInfo: () => Promise<null>;
      getParsedTokenAccountsByOwner: () => Promise<{ value: [] }>;
    }) => Promise<unknown>,
  ) =>
    fn({
      getMinimumBalanceForRentExemption: async () => 5000,
      getLatestBlockhash: async () => ({ blockhash: 'test', lastValidBlockHeight: 123 }),
      sendRawTransaction: sendRawTransactionMock,
      sendTransaction: sendRawTransactionMock,
      getBalance: async () => 2 * LAMPORTS_PER_SOL,
      getAccountInfo: async () => null,
      getParsedTokenAccountsByOwner: async () => ({ value: [] }),
    } as unknown as Parameters<typeof fn>[0]),
}));

vi.mock('../../electron/services/jupiterClient', () => ({
  getJupiterQuote: vi.fn(async () => ({
    data: {
      quoteResponse: {
        swapTransaction: Buffer.from(new Uint8Array(64)).toString('base64'),
      },
    },
  })),
}));

describe('funding/trade integration', () => {
  const mainKeypair = Keypair.generate();
  const sideKeypairs = [Keypair.generate(), Keypair.generate()];

  const liveConfig = {
    executionMode: 'live' as const,
    rpc: {
      primary: 'https://rpc.ankr.com/solana',
      fallbacks: [],
    },
    mainWalletPath: './wallets/main.json',
    walletsDir: './wallets',
    funding: {
      minSol: 0.1,
      maxSol: 0.2,
      minRentBufferSol: 0.02,
    },
    trade: {
      tokens: [
        {
          mint: 'So11111111111111111111111111111111111111112',
          symbol: 'SOL',
          decimals: 9,
        },
      ],
      slippageBpsDefault: 100,
      orderSizing: {
        unit: 'SOL',
        min: 0.05,
        max: 0.2,
      },
      priorityFee: {
        strategy: 'adaptive',
        maxMicroLamports: 300_000,
      },
    },
    limits: {
      maxConcurrent: 4,
      qpsPerRpc: 8,
      jitterMs: {
        min: 0,
        max: 0,
      },
      cycleMs: 1000,
    },
    logging: {
      level: 'info',
      json: true,
    },
    storage: {
      keyFormat: 'solana-keygen-json',
      encryption: 'off',
    },
  } as const;

  beforeEach(() => {
    setRandomSeed(42);
    vi.spyOn(configService, 'getConfig').mockReturnValue(JSON.parse(JSON.stringify(liveConfig)));
    vi.mocked(getMainWallet).mockReturnValue({ publicKey: mainKeypair.publicKey.toBase58(), role: 'main' });
    vi.mocked(getSideWallets).mockReturnValue(
      sideKeypairs.map((kp) => ({ publicKey: kp.publicKey.toBase58(), role: 'side' })),
    );
    vi.mocked(loadKeypair).mockImplementation((publicKey: string) => {
      if (publicKey === mainKeypair.publicKey.toBase58()) {
        return mainKeypair;
      }
      const match = sideKeypairs.find((kp) => kp.publicKey.toBase58() === publicKey);
      if (!match) {
        throw new Error(`Unknown wallet ${publicKey}`);
      }
      return match;
    });
    sendRawTransactionMock.mockResolvedValue('test-signature');
  });

  afterEach(() => {
    setRandomSeed(undefined);
    vi.clearAllMocks();
  });

  it('funds wallets and submits trades', async () => {
    const fundingResults = await fundingService.fundSideWallets();
    expect(fundingResults).toHaveLength(2);
    for (const entry of fundingResults) {
      expect(entry.lamports).toBeGreaterThanOrEqual(0.02 * LAMPORTS_PER_SOL);
      expect(entry.signature ?? entry.error).toBeDefined();
    }

    const tradeSignatures = await tradeService.executeTrades(
      'So11111111111111111111111111111111111111112',
      'buy',
    );
    expect(Array.isArray(tradeSignatures)).toBe(true);
    expect(tradeSignatures.every((sig) => typeof sig === 'string')).toBe(true);
  });
});
