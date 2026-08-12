import QuickLRU from 'quick-lru';
import { getConfig } from './configService';
import { logger } from './logger';

type QuoteResponse = Record<string, unknown> & {
  data?: {
    quoteResponse?: unknown;
  };
  error?: {
    message?: string;
    code?: string | number;
  };
  errorCode?: string;
};

type SwapResponse = {
  swapTransaction?: string;
  error?: {
    message?: string;
    code?: string | number;
  };
};

const cache = new QuickLRU<string, { response: QuoteResponse; expires: number }>({ maxSize: 100 });

const CACHE_TTL_MS = 5_000;

const buildUrl = (endpoint: string, params: Record<string, string | number | boolean>) => {
  const url = new URL(`https://quote-api.jup.ag/v6/${endpoint}`);
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  return url.toString();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithRetry = async (url: string, options: RequestInit = {}, retries = 3): Promise<Response> => {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const response = await fetch(url, options);
      if (response.status === 429) {
        // Rate limited - wait and retry
        const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
        logger.warn({ url, attempt, delay }, 'Jupiter rate limited, retrying');
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
  throw lastError ?? new Error('Jupiter request failed after retries');
};

const fetchWithCache = async (url: string) => {
  const cached = cache.get(url);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.response;
  }

  const response = await fetchWithRetry(url, {
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Jupiter request failed: ${response.status} ${text}`);
  }

  const json = (await response.json()) as QuoteResponse;
  if (!json.error) {
    cache.set(url, { response: json, expires: now + CACHE_TTL_MS });
  }
  return json;
};

export const getJupiterQuote = async (params: Record<string, string | number | boolean>) => {
  const config = getConfig();
  const url = buildUrl('quote', {
    slippageBps: config.trade.slippageBpsDefault,
    ...params,
  });
  try {
    const response = await fetchWithCache(url);
    const { error, errorCode } = response ?? {};

    const quoteResponse = response?.data?.quoteResponse ?? response;

    if (!quoteResponse || typeof quoteResponse !== 'object') {
      logger.warn({ url, params, error, errorCode }, 'Jupiter quote missing data');
      throw new Error((error && error.message) || 'Jupiter quote missing data');
    }

    if (error) {
      logger.warn({ url, params, error, errorCode }, 'Jupiter quote error');
      throw new Error(error.message ?? 'Jupiter quote error');
    }

    return quoteResponse as Record<string, unknown>;
  } catch (error) {
    const errorDetails = error instanceof Error
      ? { message: error.message, name: error.name }
      : { message: String(error) };
    logger.error({ error: errorDetails, url }, 'Failed to fetch Jupiter quote');
    throw error;
  }
};

export const postJupiterSwap = async (payload: unknown) => {
  const response = await fetchWithRetry('https://quote-api.jup.ag/v6/swap', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    logger.error({ text }, 'Jupiter swap failed');
    throw new Error(`Jupiter swap failed: ${response.status}`);
  }

  return response.json();
};

export const getJupiterSwapTransaction = async (
  payload: Record<string, unknown>,
): Promise<string> => {
  const response = (await postJupiterSwap(payload)) as SwapResponse;
  if (!response.swapTransaction) {
    logger.warn({ payload, response }, 'Jupiter swap missing transaction');
    throw new Error(response.error?.message ?? 'Jupiter swap missing transaction');
  }
  return response.swapTransaction;
};

export const tryJupiterSwaps = async (
  basePayload: Record<string, unknown>,
): Promise<{ swapTransaction: string; usedSharedAccounts: boolean }> => {
  const sharedPayload = { ...basePayload, useSharedAccounts: true };
  try {
    const sharedTx = await getJupiterSwapTransaction(sharedPayload);
    return { swapTransaction: sharedTx, usedSharedAccounts: true };
  } catch (sharedError) {
    const errorDetails = sharedError instanceof Error
      ? { message: sharedError.message, name: sharedError.name }
      : { message: String(sharedError) };
    logger.warn({ error: errorDetails, basePayload }, 'Jupiter shared-account swap failed; retrying without shared accounts');
  }

  const directPayload = { ...basePayload, useSharedAccounts: false };
  const directTx = await getJupiterSwapTransaction(directPayload);
  return { swapTransaction: directTx, usedSharedAccounts: false };
};
