import { Connection, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  getAssociatedTokenAddressSync,
  getAccount,
} from '@solana/spl-token';
import { mnemonicToSeedSync, validateMnemonic, generateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english';
import { HDKey } from '@scure/bip32';
import { Buffer } from 'buffer';
import bs58 from 'bs58';
import { HeliusRpcUrl, NOC_TOKEN_MINT, SHIELD_PROGRAM_ID } from './constants';

export const connection = new Connection(HeliusRpcUrl, 'confirmed');

async function estimateTransactionFeeInSol(tx: Transaction, feePayer: PublicKey): Promise<number> {
  const { blockhash } = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = feePayer;
  tx.recentBlockhash = blockhash;
  const { value } = await connection.getFeeForMessage(tx.compileMessage());
  if (value == null) {
    throw new Error('Fee estimate unavailable');
  }
  return value / LAMPORTS_PER_SOL;
}

function parseSecretKeyInput(secret: string): Uint8Array {
  const trimmed = secret.trim();
  if (!trimmed) {
    throw new Error('Secret key is empty. Paste a base58 string or the JSON array exported by `solana-keygen`.');
  }

  if (trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (!Array.isArray(parsed)) {
        throw new Error();
      }
      if (!parsed.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
        throw new Error();
      }
      return Uint8Array.from(parsed);
    } catch {
      throw new Error('Secret key JSON must be an array of byte values between 0 and 255.');
    }
  }

  if (/^\d+(?:\s*,\s*\d+)+$/.test(trimmed)) {
    const bytes = trimmed
      .split(',')
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((value) => Number.isFinite(value));
    if (bytes.every((value) => value >= 0 && value <= 255)) {
      return Uint8Array.from(bytes);
    }
  }

  try {
    return bs58.decode(trimmed);
  } catch {
    // fall through to optional base64 handling
  }

  if (/^[0-9a-zA-Z+/=]+$/.test(trimmed)) {
    const buffer = Buffer.from(trimmed, 'base64');
    if (buffer.length > 0) {
      return new Uint8Array(buffer);
    }
  }

  throw new Error('Secret key must be base58, base64, or a JSON array from `solana-keygen`.');
}

export function mnemonicToKeypair(mnemonic: string, passphrase = ''): Keypair {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid BIP39 mnemonic');
  }
  const seed = mnemonicToSeedSync(mnemonic, passphrase).subarray(0, 32);
  return Keypair.fromSeed(seed);
}

export function generateNewMnemonic(): string {
  return generateMnemonic(wordlist, 128);
}

/**
 * Derive a Solana keypair from mnemonic using HD derivation with a specific account index.
 * Uses BIP-44 path: m/44'/501'/accountIndex'/0'
 * - 44' = BIP-44 purpose
 * - 501' = Solana coin type
 * - accountIndex' = account number (0 for main wallet, 1+ for additional wallets)
 * - 0' = change index (always 0 for Solana)
 * 
 * @param mnemonic - 12 or 24 word BIP39 mnemonic
 * @param accountIndex - Account derivation index (0 = main, 1 = second wallet, etc.)
 * @param passphrase - Optional BIP39 passphrase
 * @returns Solana Keypair for the derived account
 */
export function mnemonicToKeypairWithIndex(mnemonic: string, accountIndex: number, passphrase = ''): Keypair {
  if (!validateMnemonic(mnemonic, wordlist)) {
    throw new Error('Invalid BIP39 mnemonic');
  }
  if (accountIndex < 0 || !Number.isInteger(accountIndex)) {
    throw new Error('Account index must be a non-negative integer');
  }
  
  // Generate 64-byte seed from mnemonic
  const seed = mnemonicToSeedSync(mnemonic, passphrase);
  
  // Create HD key from seed
  const hdKey = HDKey.fromMasterSeed(seed);
  
  // Derive using Solana's BIP-44 path: m/44'/501'/accountIndex'/0'
  const derivationPath = `m/44'/501'/${accountIndex}'/0'`;
  const derived = hdKey.derive(derivationPath);
  
  if (!derived.privateKey) {
    throw new Error('Failed to derive private key');
  }
  
  // Use the 32-byte private key as seed for Solana keypair
  return Keypair.fromSeed(derived.privateKey);
}

export function secretKeyToKeypair(secret: string): Keypair {
  const decoded = parseSecretKeyInput(secret);
  if (decoded.length === 64) {
    return Keypair.fromSecretKey(decoded);
  }
  if (decoded.length === 32) {
    return Keypair.fromSeed(decoded);
  }
  throw new Error(`Secret key must decode to 32 or 64 bytes. Received ${decoded.length} bytes.`);
}

export function keypairToSecret(keypair: Keypair): string {
  return bs58.encode(keypair.secretKey);
}

export async function requestSolAirdrop(keypair: Keypair, sol = 1): Promise<string> {
  const signature = await connection.requestAirdrop(keypair.publicKey, sol * 1_000_000_000);
  await connection.confirmTransaction(signature, 'confirmed');
  return signature;
}

export async function getSolBalance(pubkey: PublicKey): Promise<number> {
  const lamports = await connection.getBalance(pubkey);
  return lamports / 1_000_000_000;
}

export async function getTokenBalance(owner: PublicKey, mint = new PublicKey(NOC_TOKEN_MINT)): Promise<number> {
  const ata = getAssociatedTokenAddressSync(mint, owner, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const accountInfo = await connection.getTokenAccountBalance(ata).catch(() => null);
  return accountInfo ? parseFloat(accountInfo.value.uiAmountString || '0') : 0;
}

export async function sendSol(from: Keypair, to: PublicKey, sol: number): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({ fromPubkey: from.publicKey, toPubkey: to, lamports: sol * 1_000_000_000 }),
  );
  tx.feePayer = from.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  
  console.log('Sending SOL transaction with blockhash:', blockhash);
  const signature = await connection.sendTransaction(tx, [from], { 
    skipPreflight: false, 
    maxRetries: 5,
    preflightCommitment: 'confirmed'
  });
  console.log('SOL transaction sent, signature:', signature);
  return signature;
}

export async function estimateSolSendFee(from: PublicKey, to: PublicKey, sol: number): Promise<number> {
  const lamports = Math.max(1, Math.floor(sol * LAMPORTS_PER_SOL));
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: from, toPubkey: to, lamports }));
  return estimateTransactionFeeInSol(tx, from);
}

export async function sendNoc(
  authority: Keypair,
  destination: PublicKey,
  amount: bigint,
  mint = new PublicKey(NOC_TOKEN_MINT),
): Promise<string> {
  const fromAta = getAssociatedTokenAddressSync(mint, authority.publicKey);
  const toAta = getAssociatedTokenAddressSync(mint, destination);
  const instructions: TransactionInstruction[] = [];
  const ataInfo = await connection.getAccountInfo(toAta);
  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        authority.publicKey,
        toAta,
        destination,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  instructions.push(createTransferInstruction(fromAta, toAta, authority.publicKey, Number(amount)));
  const tx = new Transaction().add(...instructions);
  tx.feePayer = authority.publicKey;
  const { blockhash } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  
  console.log('Connection RPC endpoint:', connection.rpcEndpoint);
  console.log('Sending transaction with blockhash:', blockhash);
  console.log('Transaction instructions count:', tx.instructions.length);
  console.log('From ATA:', fromAta.toBase58());
  console.log('To ATA:', toAta.toBase58());
  console.log('Amount:', amount.toString());
  
  const rawTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
  console.log('Unsigned transaction size:', rawTx.length);
  
  tx.sign(authority);
  const signedTx = tx.serialize();
  console.log('Signed transaction size:', signedTx.length);
  
  const signature = await connection.sendRawTransaction(signedTx, { 
    skipPreflight: false, 
    maxRetries: 5,
    preflightCommitment: 'confirmed'
  });
  console.log('Transaction sent, signature:', signature);
  return signature;
}


export async function estimateNocSendFee(
  authority: PublicKey,
  destination: PublicKey,
  amount: bigint,
  mint = new PublicKey(NOC_TOKEN_MINT),
): Promise<number> {
  const fromAta = getAssociatedTokenAddressSync(mint, authority);
  const toAta = getAssociatedTokenAddressSync(mint, destination);
  const instructions: TransactionInstruction[] = [];
  const ataInfo = await connection.getAccountInfo(toAta);
  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        authority,
        toAta,
        destination,
        mint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      ),
    );
  }
  instructions.push(createTransferInstruction(fromAta, toAta, authority, Number(amount)));
  const tx = new Transaction().add(...instructions);
  return estimateTransactionFeeInSol(tx, authority);
}

export async function estimateBaseTransactionFee(payer: PublicKey): Promise<number> {
  const tx = new Transaction();
  return estimateTransactionFeeInSol(tx, payer);
}

export function buildShieldedInstruction(
  data: Uint8Array,
  keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(SHIELD_PROGRAM_ID),
    keys,
    data: Buffer.from(data),
  });
}

/**
 * Get or create a wSOL (Wrapped SOL) token account for the user.
 * Returns the ATA address.
 */
export function getWsolAta(owner: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(NATIVE_MINT, owner);
}

/**
 * Wrap SOL to wSOL by:
 * 1. Creating the wSOL ATA if needed
 * 2. Transferring SOL to the ATA
 * 3. Syncing the native balance
 */
export async function wrapSol(
  keypair: Keypair,
  amountLamports: number,
): Promise<{ signature: string; wsolAta: PublicKey }> {
  const wsolAta = getWsolAta(keypair.publicKey);
  const instructions: TransactionInstruction[] = [];

  // Check if wSOL ATA exists
  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    instructions.push(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        wsolAta,
        keypair.publicKey,
        NATIVE_MINT,
      ),
    );
  }

  // Transfer SOL to the wSOL ATA
  instructions.push(
    SystemProgram.transfer({
      fromPubkey: keypair.publicKey,
      toPubkey: wsolAta,
      lamports: amountLamports,
    }),
  );

  // Sync native balance to update the token account
  instructions.push(createSyncNativeInstruction(wsolAta));

  const tx = new Transaction().add(...instructions);
  const signature = await sendAndConfirmTransaction(connection, tx, [keypair]);
  
  return { signature, wsolAta };
}

/**
 * Unwrap wSOL back to native SOL by closing the wSOL token account.
 * All wSOL in the account will be converted to SOL.
 */
export async function unwrapSol(keypair: Keypair): Promise<string> {
  const wsolAta = getWsolAta(keypair.publicKey);
  
  // Check if account exists and has balance
  const ataInfo = await connection.getAccountInfo(wsolAta);
  if (!ataInfo) {
    throw new Error('No wSOL account found to unwrap');
  }

  const tx = new Transaction().add(
    createCloseAccountInstruction(
      wsolAta,
      keypair.publicKey, // SOL destination
      keypair.publicKey, // owner
    ),
  );
  
  return sendAndConfirmTransaction(connection, tx, [keypair]);
}

/**
 * Get wSOL balance for a wallet
 */
export async function getWsolBalance(owner: PublicKey): Promise<number> {
  try {
    const wsolAta = getWsolAta(owner);
    const account = await getAccount(connection, wsolAta);
    return Number(account.amount) / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}
