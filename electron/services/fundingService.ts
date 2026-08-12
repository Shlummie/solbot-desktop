import {
  Keypair,
  PublicKey,
  ComputeBudgetProgram,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import pLimit from 'p-limit';
import { getConfig } from './configService';
import { withRpc } from './rpcClient';
import { logger } from './logger';
import { randomInRange, shuffle } from '@shared/utils/random';
import { getMainWallet, getSideWallets, loadKeypair } from './walletService';
import type { FundingResult } from '@shared/types/funding';
import { assertLiveExecution } from './executionMode';

// Cache rent exemption for 5 minutes (rarely changes)
let cachedRentExemption: { value: number; expires: number } | null = null;

const getRentExemption = async (): Promise<number> => {
  const now = Date.now();
  if (cachedRentExemption && cachedRentExemption.expires > now) {
    return cachedRentExemption.value;
  }
  
  const value = await withRpc((connection) => connection.getMinimumBalanceForRentExemption(0));
  cachedRentExemption = { value, expires: now + 5 * 60 * 1000 };
  return value;
};

const computePriorityFeeIx = (microLamports: number) =>
  ComputeBudgetProgram.setComputeUnitPrice({ microLamports });

const computeUnitLimitIx = (units: number) =>
  ComputeBudgetProgram.setComputeUnitLimit({ units });

const fundWallet = async (source: Keypair, target: PublicKey, amountLamports: number) => {
  return withRpc(async (connection) => {
    const { trade } = getConfig();
    const latestBlockhash = await connection.getLatestBlockhash('finalized');
    const transaction = new Transaction({
      feePayer: source.publicKey,
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
    });
    // Simple SOL transfer needs ~200 CUs, set limit for accurate fee estimation
    transaction.add(computeUnitLimitIx(500));
    transaction.add(computePriorityFeeIx(trade.priorityFee.maxMicroLamports));
    transaction.add(
      SystemProgram.transfer({
        fromPubkey: source.publicKey,
        toPubkey: target,
        lamports: amountLamports,
      }),
    );
    transaction.sign(source);
    const signature = await connection.sendRawTransaction(transaction.serialize(), {
      skipPreflight: false,
    });
    return signature;
  });
};

const history: FundingResult[] = [];

type FundingTask = {
  wallet: string;
  lamports: number;
};

const executeSingleFunding = async (
  sourceKeypair: Keypair,
  task: FundingTask,
): Promise<FundingResult> => {
  try {
    const signature = await fundWallet(sourceKeypair, new PublicKey(task.wallet), task.lamports);
    logger.info({ wallet: task.wallet, signature, lamports: task.lamports }, 'Funded wallet');
    return {
      wallet: task.wallet,
      lamports: task.lamports,
      signature,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ error: message, wallet: task.wallet }, 'Failed funding wallet');
    return {
      wallet: task.wallet,
      lamports: task.lamports,
      error: message,
      timestamp: new Date().toISOString(),
    };
  }
};

export const fundSideWallets = async (targetKeys?: string[]): Promise<FundingResult[]> => {
  const config = getConfig();
  assertLiveExecution(config, 'Wallet funding');
  const mainWalletMeta = getMainWallet();
  const sideWallets = targetKeys?.length
    ? getSideWallets().filter((wallet) => targetKeys.includes(wallet.publicKey))
    : shuffle(getSideWallets());
  
  if (!mainWalletMeta) {
    throw new Error('Main wallet not configured');
  }

  const sourceKeypair = loadKeypair(mainWalletMeta.publicKey);
  const rentBuffer = await getRentExemption();

  // Prepare all funding tasks
  const tasks: FundingTask[] = sideWallets.map((wallet) => {
    const amountSol = randomInRange(config.funding.minSol ?? 0, config.funding.maxSol ?? 0);
    const rentBufferSol = config.funding.minRentBufferSol * LAMPORTS_PER_SOL;
    const lamports = Math.max(Math.floor(amountSol * LAMPORTS_PER_SOL), Math.max(rentBuffer, rentBufferSol));
    return { wallet: wallet.publicKey, lamports };
  });

  // Process in parallel with controlled concurrency
  const limit = pLimit(config.limits.maxConcurrent);
  
  logger.info({ walletCount: tasks.length, concurrency: config.limits.maxConcurrent }, 'Starting parallel funding');

  const fundingPromises = tasks.map((task) =>
    limit(() => executeSingleFunding(sourceKeypair, task))
  );

  const results = await Promise.all(fundingPromises);

  // Update history
  for (const result of results) {
    history.unshift(result);
  }

  // Cap history to prevent memory growth
  if (history.length > 200) {
    history.length = 200;
  }

  const successful = results.filter((r) => r.signature).length;
  logger.info({ total: tasks.length, successful, failed: tasks.length - successful }, 'Funding complete');

  return results;
};

export const getFundingHistory = () => history.slice(0, 50);
