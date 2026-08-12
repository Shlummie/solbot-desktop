import { z } from 'zod';

export const configSchema = z.object({
  executionMode: z.union([z.literal('dry-run'), z.literal('live')]),
  rpc: z.object({
    primary: z.string().url(),
    fallbacks: z.array(z.string().url()),
    keyed: z
      .object({
        helius: z.string().optional(),
        alchemy: z.string().optional(),
        syndica: z.string().optional(),
      })
      .partial()
      .optional(),
  }),
  mainWalletPath: z.string(),
  walletsDir: z.string(),
  funding: z.object({
    minSol: z.number().optional(),
    maxSol: z.number().optional(),
    minRentBufferSol: z.number(),
  }),
  trade: z.object({
    tokens: z.array(
      z.object({
        mint: z.string(),
        symbol: z.string().optional(),
        decimals: z.number().optional(),
      }),
    ),
    slippageBpsDefault: z.number(),
    orderSizing: z.object({
      unit: z.literal('SOL'),
      min: z.number(),
      max: z.number(),
    }),
    priorityFee: z.object({
      strategy: z.literal('adaptive'),
      maxMicroLamports: z.number(),
    }),
  }),
  limits: z.object({
    maxConcurrent: z.number(),
    qpsPerRpc: z.number(),
    jitterMs: z.object({
      min: z.number(),
      max: z.number(),
    }),
    cycleMs: z.number().min(500),
  }),
  logging: z.object({
    level: z.union([z.literal('info'), z.literal('debug')]),
    json: z.boolean(),
    file: z.string().optional(),
  }),
  storage: z.object({
    keyFormat: z.literal('solana-keygen-json'),
    encryption: z.literal('off'),
  }),
});

export type AppConfig = z.infer<typeof configSchema>;

export const defaultConfig: AppConfig = {
  executionMode: 'dry-run',
  rpc: {
    primary: 'https://api.devnet.solana.com',
    fallbacks: [],
  },
  mainWalletPath: './wallets/main.json',
  walletsDir: './wallets',
  funding: {
    minSol: 0.01,
    maxSol: 0.02,
    minRentBufferSol: 0.002,
  },
  trade: {
    tokens: [],
    slippageBpsDefault: 100,
    orderSizing: {
      unit: 'SOL',
      min: 0.001,
      max: 0.002,
    },
    priorityFee: {
      strategy: 'adaptive',
      maxMicroLamports: 10_000,
    },
  },
  limits: {
    maxConcurrent: 2,
    qpsPerRpc: 4,
    jitterMs: {
      min: 500,
      max: 1500,
    },
    cycleMs: 5000,
  },
  logging: {
    level: 'info',
    json: true,
  },
  storage: {
    keyFormat: 'solana-keygen-json',
    encryption: 'off',
  },
};
