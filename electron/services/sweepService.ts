import {
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
  Connection,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
} from '@solana/spl-token';
import { getConfig } from './configService';
import { getMainWallet, getSideWallets, loadKeypair } from './walletService';
import { withRpc } from './rpcClient';
import { logger } from './logger';
import { randomDelay } from '@shared/utils/random';
import type { SweepResult, SweepRequest } from '@shared/types/sweep';
import { assertLiveExecution } from './executionMode';

const MIN_RETAIN_SOL = 0.001 * LAMPORTS_PER_SOL;

// Cache rent exemption
let rentExemptionCache: { value: number; expires: number } | null = null;

const getRentExemption = async (connection: Connection): Promise<number> => {
  const now = Date.now();
  if (rentExemptionCache && rentExemptionCache.expires > now) {
    return rentExemptionCache.value;
  }
  const value = await connection.getMinimumBalanceForRentExemption(0);
  rentExemptionCache = { value, expires: now + 5 * 60 * 1000 };
  return value;
};

const fetchTokenAmount = async (
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
) => {
  const parsed = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  let total = 0n;
  let sourceAta: PublicKey | null = null;
  for (const account of parsed.value) {
    const info = account.account.data as unknown as {
      parsed: { info: { tokenAmount: { amount: string } } };
    };
    const amountStr = info?.parsed?.info?.tokenAmount?.amount ?? '0';
    const amount = BigInt(amountStr);
    if (amount > 0n) {
      total += amount;
      if (!sourceAta) {
        sourceAta = new PublicKey(account.pubkey);
      }
    }
  }
  return { amount: total, sourceAta };
};

export const sweepSideWallets = async (
  request: SweepRequest,
): Promise<SweepResult[]> => {
  const { includeTokens, includeSol = true, minRentLamports } = request;
  const config = getConfig();
  assertLiveExecution(config, 'Wallet sweep');
  const mainMeta = getMainWallet();
  if (!mainMeta) {
    throw new Error('Main wallet not configured');
  }

  const mainKeypair = loadKeypair(mainMeta.publicKey);
  const sideWallets = getSideWallets();

  const results: SweepResult[] = [];

  for (const walletMeta of sideWallets) {
    const walletKeypair = loadKeypair(walletMeta.publicKey);
    const sweepResult: SweepResult = {
      wallet: walletMeta.publicKey,
      tokens: [],
    };

    try {
      const outcome = await withRpc(async (connection) => {
        const instructions = [] as Array<ReturnType<typeof SystemProgram.transfer>>;
        const computeInstructions: Array<ReturnType<typeof createAssociatedTokenAccountInstruction>> = [];
        const tokenInstructions: Array<ReturnType<typeof createTransferInstruction>> = [];

        const balance = await connection.getBalance(walletKeypair.publicKey);
        const rentExempt = minRentLamports ?? (await getRentExemption(connection));
        const retain = Math.max(rentExempt, MIN_RETAIN_SOL);
        const solLamports = Math.max(0, balance - retain);
        if (includeSol && solLamports > 0) {
          sweepResult.solLamports = solLamports;
          instructions.push(
            SystemProgram.transfer({
              fromPubkey: walletKeypair.publicKey,
              toPubkey: mainKeypair.publicKey,
              lamports: solLamports,
            }),
          );
        }

        for (const mintStr of includeTokens) {
          try {
            const mint = new PublicKey(mintStr);
            const { amount, sourceAta } = await fetchTokenAmount(connection, walletKeypair.publicKey, mint);
            if (amount > 0n && sourceAta) {
              const destAta = getAssociatedTokenAddressSync(mint, mainKeypair.publicKey);
              const destInfo = await connection.getAccountInfo(destAta);
              if (!destInfo) {
                computeInstructions.push(
                  createAssociatedTokenAccountInstruction(
                    walletKeypair.publicKey,
                    destAta,
                    mainKeypair.publicKey,
                    mint,
                  ),
                );
              }
              tokenInstructions.push(
                createTransferInstruction(sourceAta, destAta, walletKeypair.publicKey, amount),
              );
              sweepResult.tokens?.push({ mint: mintStr, amount: amount.toString() });
            }
          } catch (tokenError) {
            const errorDetails = tokenError instanceof Error
              ? { message: tokenError.message }
              : { message: String(tokenError) };
            logger.warn({ error: errorDetails, mint: mintStr, wallet: walletMeta.publicKey }, 'Token sweep skipped');
          }
        }

        const allInstructions = [...instructions, ...computeInstructions, ...tokenInstructions];
        if (allInstructions.length === 0) {
          return sweepResult;
        }

        const latest = await connection.getLatestBlockhash('finalized');
        const transaction = new Transaction({
          feePayer: walletKeypair.publicKey,
          recentBlockhash: latest.blockhash,
        });

        // Add compute budget for better fee estimation
        const computeUnits = 200 + (allInstructions.length * 50_000);
        transaction.add(ComputeBudgetProgram.setComputeUnitLimit({ units: Math.min(computeUnits, 400_000) }));
        transaction.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: config.trade.priorityFee.maxMicroLamports }));

        allInstructions.forEach((ix) => transaction.add(ix));
        transaction.sign(walletKeypair);
        const serialized = transaction.serialize();
        const signature = await connection.sendRawTransaction(serialized, {
          skipPreflight: false,
          maxRetries: 3,
        });
        sweepResult.signature = signature;
        logger.info({ wallet: walletMeta.publicKey, signature, solLamports, tokenCount: tokenInstructions.length }, 'Sweep submitted');
        return sweepResult;
      });

      results.push(outcome);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ ...sweepResult, error: message });
      const errorDetails = error instanceof Error
        ? { message: error.message, name: error.name }
        : { message: String(error) };
      logger.error({ error: errorDetails, wallet: walletMeta.publicKey }, 'Sweep failed');
    }

    // Stagger sweeps between wallets to avoid rate limits
    if (sideWallets.length > 1) {
      await randomDelay(config.limits.jitterMs.min, config.limits.jitterMs.max);
    }
  }

  return results;
};
