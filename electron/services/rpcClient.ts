import pLimit from 'p-limit';
import QuickLRU from 'quick-lru';
import { Connection } from '@solana/web3.js';
import { getConfig } from './configService';
import { logger } from './logger';
import { randomDelay } from '@shared/utils/random';

type RpcEndpoint = {
  url: string;
  limiter: ReturnType<typeof pLimit>;
  failureCount: number;
  latencySamples: number[];
  totalRequests: number;
  lastLatency: number | null;
  ongoingRequests: number;
  requestTimestamps: number[];
  throttled: number;
  backoffCount: number;
  backoffUntil: number;
};

const CACHE_TTL_MS = 30_000;
const windowDurationMs = 1_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1000;

const purgeOldTimestamps = (endpoint: RpcEndpoint, now: number) => {
  while (endpoint.requestTimestamps.length > 0) {
    const first = endpoint.requestTimestamps[0];
    if (first === undefined || now - first <= windowDurationMs) {
      break;
    }
    endpoint.requestTimestamps.shift();
  }
};

const ensureQpsBudget = async (endpoint: RpcEndpoint, qpsLimit: number) => {
  const now = Date.now();
  
  // Check if endpoint is in backoff period
  if (endpoint.backoffUntil > now) {
    const waitMs = endpoint.backoffUntil - now;
    logger.debug({ endpoint: endpoint.url, waitMs }, 'Waiting for backoff period');
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  purgeOldTimestamps(endpoint, now);
  if (endpoint.requestTimestamps.length < qpsLimit) {
    return;
  }

  const earliest = endpoint.requestTimestamps[0];
  if (earliest === undefined) {
    return;
  }
  const waitMs = Math.max(0, windowDurationMs - (now - earliest));
  endpoint.throttled += 1;
  await new Promise((resolve) => setTimeout(resolve, waitMs));
};

const connectionCache = new QuickLRU<string, { connection: Connection; expires: number }>({
  maxSize: 10,
});

const getConnection = (url: string) => {
  const cached = connectionCache.get(url);
  const now = Date.now();
  if (cached && cached.expires > now) {
    return cached.connection;
  }

  const connection = new Connection(url, {
    commitment: 'confirmed',
  });
  connectionCache.set(url, { connection, expires: now + CACHE_TTL_MS });
  return connection;
};

let endpoints: RpcEndpoint[] = [];
let lastConfigHash = '';

const getConfigHash = () => {
  const config = getConfig();
  return JSON.stringify([config.rpc.primary, ...config.rpc.fallbacks]);
};

const initEndpoints = () => {
  const config = getConfig();
  const urls = [config.rpc.primary, ...config.rpc.fallbacks].filter(Boolean);
  endpoints = urls.map((url) => ({
    url,
    limiter: pLimit(config.limits.maxConcurrent),
    failureCount: 0,
    latencySamples: [],
    totalRequests: 0,
    lastLatency: null,
    ongoingRequests: 0,
    requestTimestamps: [],
    throttled: 0,
    backoffCount: 0,
    backoffUntil: 0,
  }));
  lastConfigHash = getConfigHash();
  logger.info({ endpoints: urls }, 'RPC endpoints initialized');
};

initEndpoints();

const pickEndpoint = () => {
  // Check if config has changed and reinitialize if needed
  const currentHash = getConfigHash();
  if (endpoints.length === 0 || currentHash !== lastConfigHash) {
    initEndpoints();
  }
  const now = Date.now();
  
  // Prefer endpoints not in backoff, then sort by failures and load
  return endpoints
    .filter((e) => e.backoffUntil <= now || endpoints.every((ep) => ep.backoffUntil > now))
    .sort((a, b) => {
      // Prefer endpoints not in backoff
      const aInBackoff = a.backoffUntil > now ? 1 : 0;
      const bInBackoff = b.backoffUntil > now ? 1 : 0;
      if (aInBackoff !== bInBackoff) return aInBackoff - bInBackoff;
      
      // Then by failure count
      if (a.failureCount !== b.failureCount) return a.failureCount - b.failureCount;
      
      // Then by current load
      return a.ongoingRequests - b.ongoingRequests;
    })[0];
};

const applyBackoff = (endpoint: RpcEndpoint) => {
  // Exponential backoff: 1s, 2s, 4s, 8s, 16s, max 30s
  const backoffMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, endpoint.backoffCount), 30_000);
  endpoint.backoffUntil = Date.now() + backoffMs;
  endpoint.backoffCount += 1;
  logger.warn({ endpoint: endpoint.url, backoffMs, backoffCount: endpoint.backoffCount }, 'Applied rate limit backoff');
};

const resetBackoff = (endpoint: RpcEndpoint) => {
  if (endpoint.backoffCount > 0) {
    endpoint.backoffCount = Math.max(0, endpoint.backoffCount - 1);
  }
};

type RpcTask<T> = (connection: Connection) => Promise<T>;

export const withRpc = async <T>(task: RpcTask<T>, retryCount = 0): Promise<T> => {
  let endpoint = pickEndpoint();
  if (!endpoint) {
    initEndpoints();
    endpoint = pickEndpoint();
  }
  if (!endpoint) {
    throw new Error('No RPC endpoints configured');
  }
  
  const config = getConfig();
  
  // Add jitter delay before request
  await randomDelay(config.limits.jitterMs.min, config.limits.jitterMs.max);

  return endpoint.limiter(async () => {
    await ensureQpsBudget(endpoint!, config.limits.qpsPerRpc);

    endpoint.totalRequests += 1;
    endpoint.ongoingRequests += 1;
    const now = Date.now();
    endpoint.requestTimestamps.push(now);
    purgeOldTimestamps(endpoint, now);

    const start = Date.now();
    try {
      const result = await task(getConnection(endpoint.url));
      const latency = Date.now() - start;
      endpoint.latencySamples.push(latency);
      if (endpoint.latencySamples.length > 50) {
        endpoint.latencySamples.shift();
      }
      endpoint.lastLatency = latency;
      
      // Successful request, reduce backoff count
      resetBackoff(endpoint);
      
      return result;
    } catch (error) {
      endpoint.failureCount += 1;
      
      const errorDetails = error instanceof Error
        ? { message: error.message, name: error.name, stack: error.stack }
        : { message: String(error) };
      
      if (isRateLimitError(error)) {
        applyBackoff(endpoint);
        
        // Retry with a different endpoint if available and retries remaining
        if (retryCount < MAX_RETRIES) {
          logger.info({ endpoint: endpoint.url, retryCount }, 'Rate limited, retrying with backoff');
          endpoint.ongoingRequests = Math.max(0, endpoint.ongoingRequests - 1);
          
          // Wait before retry
          const retryDelay = BASE_BACKOFF_MS * Math.pow(2, retryCount);
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          
          return withRpc(task, retryCount + 1);
        }
      }
      
      logger.warn({ endpoint: endpoint.url, error: errorDetails, retryCount }, 'RPC request failed');
      throw error;
    } finally {
      endpoint.ongoingRequests = Math.max(0, endpoint.ongoingRequests - 1);
    }
  });
};

const isRateLimitError = (error: unknown) => {
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('429') || message.toLowerCase().includes('rate limit') || message.includes('Too many requests');
};

export const getRpcHealth = () => {
  const config = getConfig();
  const now = Date.now();
  return endpoints.map((endpoint) => {
    const averageLatency =
      endpoint.latencySamples.reduce((acc, curr) => acc + curr, 0) /
      (endpoint.latencySamples.length || 1);
    purgeOldTimestamps(endpoint, now);
    return {
      url: endpoint.url,
      failureCount: endpoint.failureCount,
      averageLatencyMs: Math.round(averageLatency),
      lastLatencyMs: endpoint.lastLatency ? Math.round(endpoint.lastLatency) : null,
      totalRequests: endpoint.totalRequests,
      throttled: endpoint.throttled,
      rateLimitBackoffs: endpoint.backoffCount,
      inFlight: endpoint.ongoingRequests,
      qpsLimit: config.limits.qpsPerRpc,
      recentQps: endpoint.requestTimestamps.length,
      inBackoff: endpoint.backoffUntil > now,
      backoffRemainingMs: Math.max(0, endpoint.backoffUntil - now),
    };
  });
};
