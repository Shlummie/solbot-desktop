import { writeFileSync, readFileSync, existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { Keypair, PublicKey } from '@solana/web3.js';
import bs58 from 'bs58';
import { getAppDirectories } from './paths';
import { logger } from './logger';
import type { WalletSummary, WalletRole } from '@shared/types/wallet';
import { getConfig } from './configService';
import { withRpc } from './rpcClient';

type WalletMetadata = {
  publicKey: string;
  role: 'main' | 'side';
  tag?: string;
};

const walletsIndexPath = () => join(getAppDirectories().walletsDir, 'index.json');

const loadIndex = (): WalletMetadata[] => {
  const path = walletsIndexPath();
  if (!existsSync(path)) {
    writeFileSync(path, JSON.stringify([], null, 2), 'utf-8');
    return [];
  }
  const data = JSON.parse(readFileSync(path, 'utf-8')) as WalletMetadata[];
  return data;
};

const saveIndex = (metadata: WalletMetadata[]) => {
  writeFileSync(walletsIndexPath(), JSON.stringify(metadata, null, 2), 'utf-8');
};

const keypairPath = (pubkey: string) => join(getAppDirectories().walletsDir, `${pubkey}.json`);

const serializeKeypair = (keypair: Keypair) => JSON.stringify(Array.from(keypair.secretKey));

const deserializeKeypair = (secret: string | number[]) => {
  let secretKey: Uint8Array;
  if (Array.isArray(secret)) {
    secretKey = new Uint8Array(secret);
  } else {
    const trimmed = secret.trim();
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error('Invalid JSON secret');
      }
      secretKey = new Uint8Array(parsed);
    } catch {
      secretKey = Uint8Array.from(bs58.decode(trimmed));
    }
  }
  return Keypair.fromSecretKey(secretKey);
};

export const loadKeypair = (publicKey: string) => {
  const path = keypairPath(publicKey);
  if (!existsSync(path)) {
    throw new Error('Keypair not found');
  }
  const data = JSON.parse(readFileSync(path, 'utf-8')) as number[];
  return deserializeKeypair(data);
};

export const getMainWallet = () => loadIndex().find((wallet) => wallet.role === 'main');

export const getSideWallets = () => loadIndex().filter((wallet) => wallet.role === 'side');

export const createWallets = (count: number, role: WalletRole = 'side') => {
  const index = loadIndex();
  const created: WalletMetadata[] = [];
  for (let i = 0; i < count; i++) {
    const keypair = Keypair.generate();
    const meta: WalletMetadata = {
      publicKey: keypair.publicKey.toBase58(),
      role,
    };
    created.push(meta);
    writeFileSync(keypairPath(meta.publicKey), serializeKeypair(keypair), 'utf-8');
    index.push(meta);
  }
  saveIndex(index);
  logger.info({ count }, 'Created wallets');
  return created;
};

export const importWalletFromFile = (sourcePath: string, role: WalletRole = 'side') => {
  const raw = readFileSync(sourcePath, 'utf-8');
  return importWalletFromSecret(raw, role);
};

export const importWalletFromSecret = (secretRaw: string | number[], role: WalletRole = 'side') => {
  const normalized = Array.isArray(secretRaw)
    ? secretRaw
    : (() => {
        const trimmed = secretRaw.trim();
        try {
          const parsed = JSON.parse(trimmed);
          if (!Array.isArray(parsed)) {
            throw new Error('Invalid JSON secret');
          }
          return parsed as number[];
        } catch {
          return Array.from(bs58.decode(trimmed)) as number[];
        }
      })();
  const keypair = Keypair.fromSecretKey(Uint8Array.from(normalized));
  const meta: WalletMetadata = {
    publicKey: keypair.publicKey.toBase58(),
    role,
  };
  writeFileSync(keypairPath(meta.publicKey), serializeKeypair(keypair), 'utf-8');
  const index = loadIndex();
  const existing = index.find((item) => item.publicKey === meta.publicKey);
  if (!existing) {
    index.push(meta);
  }
  saveIndex(index);
  logger.info({ publicKey: meta.publicKey }, 'Imported wallet');
  return meta;
};

export const exportWallet = (publicKey: string, destination: string) => {
  const path = keypairPath(publicKey);
  if (!existsSync(path)) {
    throw new Error('Wallet not found');
  }
  const data = readFileSync(path, 'utf-8');
  writeFileSync(destination, data, 'utf-8');
  logger.info({ publicKey }, 'Exported wallet');
};

export type ExportedWallet = {
  publicKey: string;
  secretKey: number[];
};

export const exportAllSideWallets = (destination: string) => {
  const index = loadIndex();
  const sideWallets = index.filter((wallet) => wallet.role === 'side');
  
  if (sideWallets.length === 0) {
    throw new Error('No side wallets to export');
  }

  const exported: ExportedWallet[] = [];
  
  for (const wallet of sideWallets) {
    const path = keypairPath(wallet.publicKey);
    if (existsSync(path)) {
      const data = JSON.parse(readFileSync(path, 'utf-8')) as number[];
      exported.push({
        publicKey: wallet.publicKey,
        secretKey: data,
      });
    }
  }

  writeFileSync(destination, JSON.stringify(exported, null, 2), 'utf-8');
  logger.info({ count: exported.length, destination }, 'Exported all side wallets');
  return exported.length;
};

export const importBulkWallets = (sourcePath: string, role: WalletRole = 'side') => {
  const raw = readFileSync(sourcePath, 'utf-8');
  const parsed = JSON.parse(raw) as ExportedWallet[];
  
  if (!Array.isArray(parsed)) {
    throw new Error('Invalid bulk wallet file: expected an array');
  }

  const index = loadIndex();
  let imported = 0;
  let skipped = 0;

  for (const wallet of parsed) {
    if (!wallet.secretKey || !Array.isArray(wallet.secretKey)) {
      logger.warn({ wallet: wallet.publicKey }, 'Skipping wallet with invalid secretKey');
      skipped++;
      continue;
    }

    try {
      const keypair = Keypair.fromSecretKey(Uint8Array.from(wallet.secretKey));
      const publicKey = keypair.publicKey.toBase58();
      
      // Check if already exists
      const existing = index.find((item) => item.publicKey === publicKey);
      if (existing) {
        logger.debug({ publicKey }, 'Wallet already exists, skipping');
        skipped++;
        continue;
      }

      const meta: WalletMetadata = { publicKey, role };
      writeFileSync(keypairPath(publicKey), serializeKeypair(keypair), 'utf-8');
      index.push(meta);
      imported++;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn({ wallet: wallet.publicKey, error: msg }, 'Failed to import wallet');
      skipped++;
    }
  }

  saveIndex(index);
  logger.info({ imported, skipped, total: parsed.length }, 'Bulk wallet import complete');
  return { imported, skipped };
};

export const listWallets = async (): Promise<WalletSummary[]> => {
  const index = loadIndex();
  
  if (index.length === 0) {
    return [];
  }

  // Batch fetch all balances in a single RPC call (max 100 per call)
  const pubkeys = index.map((meta) => new PublicKey(meta.publicKey));
  const balanceMap = new Map<string, number>();

  try {
    await withRpc(async (connection) => {
      // Process in batches of 100 (RPC limit)
      const batchSize = 100;
      for (let i = 0; i < pubkeys.length; i += batchSize) {
        const batch = pubkeys.slice(i, i + batchSize);
        const accounts = await connection.getMultipleAccountsInfo(batch);
        
        accounts.forEach((account, idx) => {
          const pubkey = batch[idx];
          if (pubkey) {
            balanceMap.set(pubkey.toBase58(), account?.lamports ?? 0);
          }
        });
      }
    });
  } catch (error) {
    logger.warn({ error }, 'Failed batch fetching balances, falling back to individual calls');
    // Fallback to individual calls if batch fails
    for (const meta of index) {
      try {
        const balance = await withRpc((connection) => connection.getBalance(new PublicKey(meta.publicKey)));
        balanceMap.set(meta.publicKey, balance);
      } catch {
        // Leave as undefined
      }
    }
  }

  return index.map((meta) => {
    const balanceLamports = balanceMap.get(meta.publicKey);
    return {
      publicKey: meta.publicKey,
      role: meta.role,
      ...(balanceLamports === undefined ? {} : { balanceLamports }),
      ...(meta.tag ? { tag: meta.tag } : {}),
    };
  });
};

export const setWalletRole = (publicKey: string, role: WalletRole) => {
  const index = loadIndex();
  const wallet = index.find((item) => item.publicKey === publicKey);
  if (!wallet) {
    throw new Error('Wallet not found');
  }
  wallet.role = role;
  saveIndex(index);
  logger.info({ publicKey, role }, 'Updated wallet role');
};

export const removeWallet = (publicKey: string) => {
  const index = loadIndex();
  const remaining = index.filter((item) => item.publicKey !== publicKey);
  if (remaining.length === index.length) {
    throw new Error('Wallet not found');
  }
  saveIndex(remaining);
  const path = keypairPath(publicKey);
  if (existsSync(path)) {
    unlinkSync(path);
  }
  logger.info({ publicKey }, 'Removed wallet');
};

