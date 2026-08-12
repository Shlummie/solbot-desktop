import { VersionedTransaction, Connection, Keypair } from '@solana/web3.js';
import { getConfig } from './configService';
import { logger } from './logger';

const PUMPFUN_API_URL = 'https://pumpportal.fun/api/trade-local';

type PumpfunTradeRequest = {
  publicKey: string;
  action: 'buy' | 'sell';
  mint: string;
  amount: number | string;
  denominatedInSol: string;
  slippage: number;
  priorityFee: number;
  pool?: 'pump' | 'raydium';
};

type PumpfunTradeResponse = {
  transaction?: string;
  error?: string;
};

const microLamportsToSol = (microLamports: number) => microLamports / 1_000_000 / 1_000_000_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (url: string, options: RequestInit, retries = 3): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.warn({ url, attempt, delay }, 'Pump.fun rate limited, retrying');
        await sleep(delay);
        continue;
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < retries - 1) {
        const delay = Math.min(500 * Math.pow(2, attempt), 3000);
        await sleep(delay);
      }
    }
  }
  throw lastError ?? new Error('Pump.fun request failed after retries');
};

export const getPumpfunTransaction = async (
  params: {
    publicKey: string;
    action: 'buy' | 'sell';
    mint: string;
    solAmount: number;
    sellPercent?: number;
    slippageBps: number;
  },
): Promise<string> => {
  const config = getConfig();
  const priorityFeeSol = microLamportsToSol(config.trade.priorityFee.maxMicroLamports);

  const isBuy = params.action === 'buy';

  // For sells, use percentage format (e.g., "100%" to sell all)
  // For buys, use SOL amount
  const amount = isBuy 
    ? params.solAmount 
    : `${params.sellPercent ?? 100}%`;

  const payload: PumpfunTradeRequest = {
    publicKey: params.publicKey,
    action: params.action,
    mint: params.mint,
    amount,
    denominatedInSol: isBuy ? 'true' : 'false',
    slippage: Math.max(1, Math.floor(params.slippageBps / 100)),
    priorityFee: priorityFeeSol,
    pool: 'pump',
  };

  logger.debug({ payload }, 'Sending pump.fun trade request');

  const response = await fetchWithRetry(PUMPFUN_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ status: response.status, text }, 'Pump.fun API request failed');
    throw new Error(`Pump.fun API error: ${response.status} ${text}`);
  }

  const contentType = response.headers.get('content-type');
  
  if (contentType?.includes('application/json')) {
    const json = (await response.json()) as PumpfunTradeResponse;
    if (json.error) {
      throw new Error(`Pump.fun error: ${json.error}`);
    }
    if (!json.transaction) {
      throw new Error('Pump.fun response missing transaction');
    }
    return json.transaction;
  }

  // Response is raw transaction bytes
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString('base64');
};

export const executePumpfunTrade = async (
  connection: Connection,
  walletKeypair: Keypair,
  params: {
    action: 'buy' | 'sell';
    mint: string;
    solAmount: number;
    sellPercent?: number;
    slippageBps: number;
  },
): Promise<string> => {
  const txBase64 = await getPumpfunTransaction({
    publicKey: walletKeypair.publicKey.toBase58(),
    ...params,
  });

  const txBuffer = Buffer.from(txBase64, 'base64');
  const transaction = VersionedTransaction.deserialize(txBuffer);
  
  transaction.sign([walletKeypair]);

  const signature = await connection.sendRawTransaction(transaction.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });

  logger.info(
    { wallet: walletKeypair.publicKey.toBase58(), action: params.action, mint: params.mint, signature },
    'Pump.fun trade submitted',
  );

  // Fire-and-forget confirmation check (don't block the next trade)
  const walletKey = walletKeypair.publicKey.toBase58();
  void (async () => {
    try {
      const latestBlockhash = await connection.getLatestBlockhash('confirmed');
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );
      
      if (confirmation.value.err) {
        logger.warn({ wallet: walletKey, signature, error: confirmation.value.err }, 'Pump.fun trade confirmed with error');
      } else {
        logger.info({ wallet: walletKey, signature }, 'Pump.fun trade confirmed');
      }
    } catch (confirmError) {
      const errorMsg = confirmError instanceof Error ? confirmError.message : String(confirmError);
      logger.debug({ wallet: walletKey, signature, error: errorMsg }, 'Pump.fun confirmation timeout (tx may still land)');
    }
  })();

  return signature;
};

