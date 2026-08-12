import { VersionedTransaction, LAMPORTS_PER_SOL, PublicKey, Connection, Keypair } from '@solana/web3.js';
import pLimit from 'p-limit';
import { getConfig } from './configService';
import { withRpc } from './rpcClient';
import { getSideWallets, loadKeypair } from './walletService';
import { randomInRange, shuffle } from '@shared/utils/random';
import { logger } from './logger';
import { getJupiterQuote, tryJupiterSwaps } from './jupiterClient';
import { executePumpfunTrade } from './pumpfunService';
import { ensureAssociatedTokenAccount } from './tokenAccountService';
import type { TradeResult } from '@shared/types/trade';
import { assertLiveExecution } from './executionMode';

const tradeHistory: TradeResult[] = [];

const WSOL_MINT = 'So11111111111111111111111111111111111111112';

const clampPercent = (value: number | undefined) => {
  if (typeof value !== 'number' || Number.isNaN(value)) return 100;
  return Math.min(100, Math.max(1, value));
};

const sumTokenBalance = async (connection: Connection, owner: PublicKey, mint: PublicKey) => {
  const parsedAccounts = await connection.getParsedTokenAccountsByOwner(owner, { mint });
  let total = 0n;
  for (const entry of parsedAccounts.value) {
    try {
      const info = (entry.account.data as { parsed?: { info?: { tokenAmount?: { amount?: string } } } })?.parsed?.info;
      const amountStr = info?.tokenAmount?.amount ?? '0';
      total += BigInt(amountStr);
    } catch (error) {
      logger.warn({ error }, 'Failed parsing token account amount');
    }
  }
  return total;
};

const executeViaPumpfun = async (
  connection: Connection,
  walletKeypair: Keypair,
  mint: string,
  side: 'buy' | 'sell',
  solAmount: number,
  sellPercent: number,
  slippageBps: number,
): Promise<string> => {
  return executePumpfunTrade(connection, walletKeypair, {
    action: side,
    mint,
    solAmount,
    ...(side === 'sell' ? { sellPercent } : {}),
    slippageBps,
  });
};

const executeViaJupiter = async (
  connection: Connection,
  walletKeypair: Keypair,
  mint: string,
  side: 'buy' | 'sell',
  quoteAmount: string | number,
  slippageBps: number,
): Promise<string> => {
  const inputMint = side === 'buy' ? WSOL_MINT : mint;
  const outputMint = side === 'buy' ? mint : WSOL_MINT;

  // Ensure ATAs exist for both input/output mints
  await ensureAssociatedTokenAccount(connection, walletKeypair, inputMint);
  await ensureAssociatedTokenAccount(connection, walletKeypair, outputMint);

  const quote = await getJupiterQuote({
    inputMint,
    outputMint,
    amount: quoteAmount,
    slippageBps,
    userPublicKey: walletKeypair.publicKey.toBase58(),
  });

  const { swapTransaction, usedSharedAccounts } = await tryJupiterSwaps({
    quoteResponse: quote,
    userPublicKey: walletKeypair.publicKey.toBase58(),
    wrapAndUnwrapSol: true,
    asLegacyTransaction: true,
    dynamicSlippage: {
      minBps: Math.max(10, Math.floor(slippageBps * 0.5)),
      maxBps: Math.max(slippageBps, Math.min(3000, slippageBps * 2)),
    },
  });

  logger.debug({ wallet: walletKeypair.publicKey.toBase58(), usedSharedAccounts }, 'Jupiter swap parameters');

  const swapBuffer = Buffer.from(swapTransaction, 'base64');
  const versionedTx = VersionedTransaction.deserialize(swapBuffer);
  versionedTx.sign([walletKeypair]);

  const signature = await connection.sendRawTransaction(versionedTx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  logger.info({ wallet: walletKeypair.publicKey.toBase58(), signature }, 'Jupiter trade submitted');

  // Fire-and-forget confirmation check (don't block the next trade)
  const walletKey = walletKeypair.publicKey.toBase58();
  void (async () => {
    try {
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );
      logger.info({ wallet: walletKey, signature }, 'Jupiter trade confirmed');
    } catch (confirmError) {
      const errorMsg = confirmError instanceof Error ? confirmError.message : String(confirmError);
      logger.debug({ wallet: walletKey, signature, error: errorMsg }, 'Jupiter confirmation timeout (tx may still land)');
    }
  })();

  return signature;
};

type TradeTaskResult = {
  wallet: string;
  signature?: string;
  error?: string;
  lamports: number;
};

const executeSingleTrade = async (
  walletPublicKey: string,
  mint: string,
  side: 'buy' | 'sell',
  buySolAmount: number,
  sellPercent: number,
  slippageBps: number,
): Promise<TradeTaskResult> => {
  const walletKeypair = loadKeypair(walletPublicKey);
  const lamports = Math.max(Math.floor(buySolAmount * LAMPORTS_PER_SOL), 0);

  try {
    const signature = await withRpc(async (connection) => {
      // For pump.fun buys, skip balance check - API will reject if insufficient
      // This saves an RPC call per wallet
      if (side === 'buy' && lamports === 0) {
        throw new Error('Lamports zero; skipped');
      }

      // For sells via pump.fun, we use percentage - no need to check balance
      // Pump.fun handles this automatically

      // Try pump.fun first (faster, handles non-graduated tokens)
      try {
        logger.debug({ wallet: walletPublicKey, side, mint }, 'Attempting pump.fun trade');
        const pumpSignature = await executeViaPumpfun(
          connection,
          walletKeypair,
          mint,
          side,
          buySolAmount,
          sellPercent,
          slippageBps,
        );
          return pumpSignature;
      } catch (pumpError) {
        const pumpErrorDetails = pumpError instanceof Error
          ? { message: pumpError.message }
          : { message: String(pumpError) };
        logger.debug({ error: pumpErrorDetails, wallet: walletPublicKey }, 'Pump.fun failed, trying Jupiter');
      }

      // Fallback to Jupiter (for graduated tokens)
      // Need to check balance for Jupiter
      let tokenAmount = 0;
      if (side === 'sell') {
        const total = await sumTokenBalance(connection, walletKeypair.publicKey, new PublicKey(mint));
        if (total === 0n) {
          throw new Error('Token balance zero; skipped');
        }
        const amountToSell = (total * BigInt(sellPercent)) / 100n;
        if (amountToSell <= 0n) {
          throw new Error('Computed sell amount zero; skipped');
        }
        tokenAmount = amountToSell > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(amountToSell);
      }

      logger.debug({ wallet: walletPublicKey, side, mint }, 'Attempting Jupiter trade');
      const quoteAmount = side === 'buy' ? lamports : tokenAmount.toString();
      const jupiterSignature = await executeViaJupiter(
        connection,
        walletKeypair,
        mint,
        side,
        quoteAmount,
        slippageBps,
      );
      return jupiterSignature;
    });

    return { wallet: walletPublicKey, signature, lamports };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    return { wallet: walletPublicKey, error: errorMsg, lamports };
  }
};

export const executeTrades = async (
  mint: string,
  side: 'buy' | 'sell',
  options?: { targetKeys?: string[]; customSol?: number; sellPercent?: number },
) => {
  const wallets = options?.targetKeys?.length
    ? options.targetKeys.map((publicKey) => ({ publicKey }))
    : shuffle(getSideWallets());
  const config = getConfig();
  assertLiveExecution(config, 'Trade execution');
  
  // Log received options for debugging
  logger.debug({
    receivedCustomSol: options?.customSol,
    receivedSellPercent: options?.sellPercent,
    customSolType: typeof options?.customSol,
    sellPercentType: typeof options?.sellPercent,
  }, 'executeTrades received options');
  
  const sellPercent = clampPercent(options?.sellPercent);
  // Use customSol if provided (from automation), otherwise use config trade settings
  const buySolAmount = (typeof options?.customSol === 'number' && options.customSol > 0) 
    ? options.customSol 
    : randomInRange(config.trade.orderSizing.min, config.trade.orderSizing.max);
  // Pump.fun tokens are volatile - enforce minimum slippage
  // Buys need higher slippage because bulk buying moves price up
  const minSlippageBps = side === 'buy' ? 2000 : 1500; // 20% buy, 15% sell minimum
  const slippageBps = Math.max(minSlippageBps, config.trade.slippageBpsDefault);

  // Process wallets in parallel with controlled concurrency
  // Use maxConcurrent from config (default 4)
  const limit = pLimit(config.limits.maxConcurrent);
  
  const source = (typeof options?.customSol === 'number' && options.customSol > 0) ? 'automation' : 'config';
  logger.info({ 
    walletCount: wallets.length, 
    side, 
    mint: mint.slice(0, 8) + '...', 
    concurrency: config.limits.maxConcurrent,
    buySolAmount: side === 'buy' ? buySolAmount.toFixed(4) : undefined,
    sellPercent: side === 'sell' ? `${sellPercent}%` : undefined,
    source,
    configRange: source === 'config' ? `${config.trade.orderSizing.min}-${config.trade.orderSizing.max}` : undefined,
  }, 'Starting trade execution');

  // Stagger delay between starting each trade task (in ms)
  const STAGGER_DELAY_MS = 200;

  const tasks = wallets.map((walletMeta, index) =>
    limit(async () => {
      // Add stagger delay based on index to spread out requests
      if (index > 0) {
        await new Promise(resolve => setTimeout(resolve, STAGGER_DELAY_MS * (index % config.limits.maxConcurrent)));
      }
      return executeSingleTrade(
        walletMeta.publicKey,
        mint,
        side,
        buySolAmount,
        sellPercent,
        slippageBps,
      );
    })
  );

  const results = await Promise.all(tasks);

  // Process results and update history
  const signatures: string[] = [];
  for (const result of results) {
    if (result.signature) {
      signatures.push(result.signature);
      tradeHistory.unshift({
        wallet: result.wallet,
        mint,
        side,
        lamports: result.lamports,
        signature: result.signature,
        timestamp: new Date().toISOString(),
      });
    } else {
      tradeHistory.unshift({
        wallet: result.wallet,
        mint,
        side,
        lamports: result.lamports,
        timestamp: new Date().toISOString(),
        ...(result.error === undefined ? {} : { error: result.error }),
      });
    }
  }

  logger.info({ 
    total: wallets.length, 
    successful: signatures.length, 
    failed: wallets.length - signatures.length 
  }, 'Trade execution complete');

  return signatures;
};

export const getTradeHistory = () => {
  // Cap history to prevent memory growth
  if (tradeHistory.length > 200) {
    tradeHistory.length = 200;
  }
  return tradeHistory.slice(0, 50);
};
