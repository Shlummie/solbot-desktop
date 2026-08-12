import { Connection, PublicKey, Transaction, Keypair } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
  AccountLayout,
} from '@solana/spl-token';
import { logger } from './logger';

// Cache token program IDs for mints (they never change)
const tokenProgramCache = new Map<string, PublicKey>();

// Cache which ATAs we've already verified exist (expires after 60s)
const ataExistsCache = new Map<string, number>();
const ATA_CACHE_TTL_MS = 60_000;

// Cache rent exemption for token accounts (5 min)
let tokenRentCache: { value: number; expires: number } | null = null;

const determineTokenProgram = async (connection: Connection, mint: PublicKey): Promise<PublicKey> => {
  const mintStr = mint.toBase58();
  
  // Check cache first
  const cached = tokenProgramCache.get(mintStr);
  if (cached) {
    return cached;
  }

  try {
    const info = await connection.getAccountInfo(mint);
    const programId = info?.owner?.equals(TOKEN_2022_PROGRAM_ID) ? TOKEN_2022_PROGRAM_ID : TOKEN_PROGRAM_ID;
    tokenProgramCache.set(mintStr, programId);
    return programId;
  } catch (error) {
    logger.warn({ error, mint: mintStr }, 'Failed fetching mint info; defaulting to SPL token program');
    return TOKEN_PROGRAM_ID;
  }
};

const getTokenRentExemption = async (connection: Connection): Promise<number> => {
  const now = Date.now();
  if (tokenRentCache && tokenRentCache.expires > now) {
    return tokenRentCache.value;
  }

  const value = await connection.getMinimumBalanceForRentExemption(AccountLayout.span);
  tokenRentCache = { value, expires: now + 5 * 60 * 1000 };
  return value;
};

export const ensureAssociatedTokenAccount = async (
  connection: Connection,
  owner: Keypair,
  mintAddress: string,
): Promise<PublicKey> => {
  const mint = new PublicKey(mintAddress);
  const tokenProgramId = await determineTokenProgram(connection, mint);
  const ata = getAssociatedTokenAddressSync(mint, owner.publicKey, false, tokenProgramId, ASSOCIATED_TOKEN_PROGRAM_ID);
  const ataKey = ata.toBase58();

  // Check if we recently verified this ATA exists
  const cachedTime = ataExistsCache.get(ataKey);
  const now = Date.now();
  if (cachedTime && now - cachedTime < ATA_CACHE_TTL_MS) {
    return ata;
  }

  const existing = await connection.getAccountInfo(ata);
  if (existing) {
    ataExistsCache.set(ataKey, now);
    return ata;
  }

  const instruction = createAssociatedTokenAccountInstruction(
    owner.publicKey,
    ata,
    owner.publicKey,
    mint,
    tokenProgramId,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  const rentLamports = await getTokenRentExemption(connection);
  const balance = await connection.getBalance(owner.publicKey);
  if (balance < rentLamports + 5_000) {
    throw new Error('Insufficient SOL to create token account. Please fund the wallet and retry.');
  }

  const latestBlockhash = await connection.getLatestBlockhash('finalized');
  const transaction = new Transaction({
    feePayer: owner.publicKey,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }).add(instruction);

  try {
    const signature = await connection.sendTransaction(transaction, [owner], {
      skipPreflight: true,
      maxRetries: 2,
    });
    logger.debug({ ata: ataKey, signature }, 'Created associated token account');
    ataExistsCache.set(ataKey, now);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.toLowerCase().includes('insufficient funds') || message.includes('custom program error: 0x1')) {
      throw new Error('Insufficient SOL to create token account. Please deposit additional SOL.');
    }
    if (String(error).includes('already in use')) {
      logger.debug({ ata: ataKey }, 'ATA already exists');
      ataExistsCache.set(ataKey, now);
    } else {
      throw error;
    }
  }

  return ata;
};

// Clear caches (useful for testing or manual refresh)
export const clearTokenCaches = () => {
  tokenProgramCache.clear();
  ataExistsCache.clear();
  tokenRentCache = null;
};
