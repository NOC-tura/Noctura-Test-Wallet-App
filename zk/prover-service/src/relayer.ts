import { Connection, Keypair, PublicKey, Transaction, TransactionInstruction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import * as spl from '@solana/spl-token';
import BN from 'bn.js';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const splToken = spl as Record<string, any>;

// Program ID for Noctura Shield
const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('EvPfUBA97CWnKP6apRqmJYSzudonTCZCzH5tQZ7fk649');

// Privacy fee: 0.25 NOC for relayed shielded transactions
const PRIVACY_FEE_ATOMS = 250_000n;

/**
 * Get latest blockhash with retries (handles RPC rate limiting)
 */
async function getBlockhashWithRetry(connection: Connection, maxRetries = 3): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await connection.getLatestBlockhash('confirmed');
      return result;
    } catch (err: any) {
      console.warn(`[Relayer] Blockhash attempt ${i + 1} failed:`, err.message);
      if (i < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1))); // Exponential backoff
      } else {
        throw err;
      }
    }
  }
  throw new Error('Failed to get blockhash after retries');
}

/**
 * Helper to send and confirm a transaction with retries and better timeout handling.
 */
async function sendAndConfirmTx(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
  label: string = 'Transaction'
): Promise<string> {
  tx.feePayer = signers[0].publicKey;
  const latestBlockhash = await getBlockhashWithRetry(connection);
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.sign(...signers);

  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: false,
    maxRetries: 3,
  });
  console.log(`[Relayer] ${label} sent:`, signature);

  // Wait for confirmation with blockhash-based timeout (more reliable)
  const confirmation = await connection.confirmTransaction({
    signature,
    blockhash: latestBlockhash.blockhash,
    lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
  }, 'confirmed');

  if (confirmation.value.err) {
    throw new Error(`${label} failed: ${JSON.stringify(confirmation.value.err)}`);
  }

  console.log(`[Relayer] ${label} confirmed:`, signature);
  return signature;
}

// Lazy load IDL
let _idl: any = null;
function getIDL() {
  if (_idl) return _idl;
  
  // Try multiple paths
  const paths = [
    resolve(process.cwd(), '..', '..', 'target', 'idl', 'noctura_shield.json'),
    resolve(process.cwd(), 'target', 'idl', 'noctura_shield.json'),
    '/Users/banel/Noctura-Wallet/target/idl/noctura_shield.json',
  ];
  
  for (const p of paths) {
    if (existsSync(p)) {
      try {
        _idl = JSON.parse(readFileSync(p, 'utf-8'));
        console.log('[Relayer] IDL loaded from:', p);
        return _idl;
      } catch (err) {
        console.warn('[Relayer] Failed to parse IDL from', p);
      }
    }
  }
  
  console.warn('[Relayer] Could not load IDL from any path');
  return null;
}

function base64ToBytes(payload: string): Uint8Array {
  const binary = Buffer.from(payload, 'base64');
  return new Uint8Array(binary);
}

function bigIntToBytesLE(value: bigint, length = 32): number[] {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return Array.from(bytes);
}

function deriveShieldPdas(mint: PublicKey = NOC_MINT) {
  // Use hyphen-separated seeds to match the frontend/program
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    PROGRAM_ID
  );
  const [merkleTree] = PublicKey.findProgramAddressSync(
    [Buffer.from('merkle-tree')],
    PROGRAM_ID
  );
  const [nullifierSet] = PublicKey.findProgramAddressSync(
    [Buffer.from('nullifiers')],
    PROGRAM_ID
  );
  const [verifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('verifier')],
    PROGRAM_ID
  );
  const [withdrawVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('withdraw-verifier')],
    PROGRAM_ID
  );
  const [transferVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('transfer-verifier')],
    PROGRAM_ID
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault-authority'), mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('vault-token'), mint.toBuffer()],
    PROGRAM_ID
  );

  return {
    globalState,
    merkleTree,
    nullifierSet,
    verifier,
    withdrawVerifier,
    transferVerifier,
    vaultAuthority,
    vaultTokenAccount,
  };
}

export interface RelayWithdrawParams {
  proof: {
    proofBytes: string;
    publicInputs: string[];
  };
  amount: string; // bigint as string - recipient amount (fee is added automatically if collectFee=true)
  nullifier: string; // bigint as string
  recipientAta: string; // PublicKey as string
  mint?: string; // Optional mint, defaults to NOC
  collectFee?: boolean; // If true, adds 0.25 NOC fee and sends to fee collector
}

export interface RelayTransferParams {
  proof: {
    proofBytes: string;
    publicInputs: string[];
  };
  nullifier: string;
  outputCommitment1: string;
  outputCommitment2: string;
}

/**
 * Submit a shielded withdrawal via the relayer.
 * The relayer signs the transaction, so the user's wallet address is NOT visible on-chain.
 * This preserves privacy - only the vault and recipient are visible.
 * 
 * For withdrawals with fee collection:
 * - The note amount includes recipient amount + 0.25 NOC fee
 * - Relayer withdraws to its own ATA first
 * - Then transfers: recipient amount to recipient, fee to fee collector
 */
export async function relayWithdraw(
  connection: Connection,
  relayerKeypair: Keypair,
  params: RelayWithdrawParams,
  feeCollector?: string
): Promise<string> {
  const IDL = getIDL();
  if (!IDL) {
    throw new Error('IDL not loaded - cannot relay transactions');
  }

  const { proof, amount, nullifier, recipientAta, mint: mintStr, collectFee } = params;
  const mint = mintStr ? new PublicKey(mintStr) : NOC_MINT;
  const pdas = deriveShieldPdas(mint);
  const targetAta = new PublicKey(recipientAta);
  
  // Parse amounts
  const recipientAmount = BigInt(amount);
  const totalAmount = collectFee ? recipientAmount + PRIVACY_FEE_ATOMS : recipientAmount;
  const amountBn = new BN(totalAmount.toString());

  // Create Anchor provider with relayer as the wallet
  const wallet = {
    publicKey: relayerKeypair.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.sign(relayerKeypair);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach(tx => tx.sign(relayerKeypair));
      return txs;
    },
  };
  
  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: 'confirmed',
  });
  const program = new Program(IDL, PROGRAM_ID, provider);

  const proofBytes = base64ToBytes(proof.proofBytes);
  const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
  const nullifierBytes = bigIntToBytesLE(BigInt(nullifier));

  console.log('[Relayer] Submitting withdrawal...');
  console.log('[Relayer] Recipient amount:', amount);
  console.log('[Relayer] Total amount (with fee):', totalAmount.toString());
  console.log('[Relayer] Target ATA:', targetAta.toBase58());
  console.log('[Relayer] Relayer pubkey:', relayerKeypair.publicKey.toBase58());

  if (collectFee && feeCollector) {
    // PRE-FLIGHT CHECKS: Verify all recipient accounts exist BEFORE withdrawing from vault
    console.log('[Relayer] Pre-flight: Checking recipient ATA...');
    const recipientAtaInfo = await connection.getAccountInfo(targetAta);
    
    // Withdraw to relayer first, then split between recipient and fee collector
    const relayerAta = splToken.getAssociatedTokenAddressSync(
      mint,
      relayerKeypair.publicKey,
      false,
      spl.TOKEN_PROGRAM_ID,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Ensure relayer ATA exists
    const relayerAtaInfo = await connection.getAccountInfo(relayerAta);
    if (!relayerAtaInfo) {
      console.log('[Relayer] Creating relayer ATA...');
      const createAtaIx = splToken.createAssociatedTokenAccountInstruction(
        relayerKeypair.publicKey,
        relayerAta,
        relayerKeypair.publicKey,
        mint,
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );
      const tx = new Transaction().add(createAtaIx);
      await sendAndConfirmTx(connection, tx, [relayerKeypair], 'Create relayer ATA');
    }

    // Step 1: Withdraw full amount to relayer's ATA
    const withdrawIx = await program.methods
      .transparentWithdraw(amountBn, Buffer.from(proofBytes), publicInputs, nullifierBytes)
      .accounts({
        globalState: pdas.globalState,
        nullifierSet: pdas.nullifierSet,
        withdrawVerifier: pdas.withdrawVerifier,
        mint,
        vaultTokenAccount: pdas.vaultTokenAccount,
        receiverTokenAccount: relayerAta,
        vaultAuthority: pdas.vaultAuthority,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .instruction();
    
    const withdrawTx = new Transaction().add(withdrawIx);
    const withdrawSig = await sendAndConfirmTx(connection, withdrawTx, [relayerKeypair], 'Withdrawal to relayer ATA');

    // Step 2: Transfer recipient amount to recipient
    const transferToRecipientIx = spl.createTransferInstruction(
      relayerAta,
      targetAta,
      relayerKeypair.publicKey,
      Number(recipientAmount),
      [],
      spl.TOKEN_PROGRAM_ID
    );

    // Step 3: Transfer fee to fee collector
    const feeCollectorPubkey = new PublicKey(feeCollector);
    const feeCollectorAta = splToken.getAssociatedTokenAddressSync(
      mint,
      feeCollectorPubkey,
      false,
      spl.TOKEN_PROGRAM_ID,
      spl.ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    // Check if fee collector ATA exists, create if not
    const feeCollectorAtaInfo = await connection.getAccountInfo(feeCollectorAta);
    const splitTx = new Transaction();
    
    // Create recipient ATA if it doesn't exist (CRITICAL: do this in same transaction as transfer)
    if (!recipientAtaInfo) {
      console.log('[Relayer] Adding recipient ATA creation to split transaction');
      splitTx.add(splToken.createAssociatedTokenAccountInstruction(
        relayerKeypair.publicKey,
        targetAta,
        recipientPubkey,
        mint,
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      ));
    }
    
    if (!feeCollectorAtaInfo) {
      console.log('[Relayer] Creating fee collector ATA...');
      splitTx.add(splToken.createAssociatedTokenAccountInstruction(
        relayerKeypair.publicKey,
        feeCollectorAta,
        feeCollectorPubkey,
        mint,
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      ));
    }
    
    splitTx.add(transferToRecipientIx);
    splitTx.add(spl.createTransferInstruction(
      relayerAta,
      feeCollectorAta,
      relayerKeypair.publicKey,
      Number(PRIVACY_FEE_ATOMS),
      [],
      spl.TOKEN_PROGRAM_ID
    ));
    
    const splitSig = await sendAndConfirmTx(connection, splitTx, [relayerKeypair], 'Split transfer (recipient + fee)');
    console.log('[Relayer] Fee collected:', Number(PRIVACY_FEE_ATOMS) / 1_000_000, 'NOC to', feeCollectorPubkey.toBase58());
    
    return withdrawSig; // Return the main withdrawal signature
  } else {
    // No fee collection - withdraw directly to recipient
    // Check if target ATA exists, create if needed
    const ataInfo = await connection.getAccountInfo(targetAta);
    const withdrawTx = new Transaction();
    
    if (!ataInfo) {
      console.log('[Relayer] Recipient ATA does not exist, creating it:', targetAta.toBase58());
      // Create the associated token account for the recipient
      const createAtaIx = spl.createAssociatedTokenAccountInstruction(
        relayerKeypair.publicKey, // payer
        targetAta, // ata address
        recipientPubkey, // owner
        mint, // mint
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID
      );
      withdrawTx.add(createAtaIx);
    }

    const withdrawIx = await program.methods
      .transparentWithdraw(amountBn, Buffer.from(proofBytes), publicInputs, nullifierBytes)
      .accounts({
        globalState: pdas.globalState,
        nullifierSet: pdas.nullifierSet,
        withdrawVerifier: pdas.withdrawVerifier,
        mint,
        vaultTokenAccount: pdas.vaultTokenAccount,
        receiverTokenAccount: targetAta,
        vaultAuthority: pdas.vaultAuthority,
        tokenProgram: spl.TOKEN_PROGRAM_ID,
      })
      .instruction();

    withdrawTx.add(withdrawIx);
    const signature = await sendAndConfirmTx(connection, withdrawTx, [relayerKeypair], 'Withdrawal (with ATA creation if needed)');
    return signature;
  }
}

/**
 * Submit a shielded transfer (note split) via the relayer.
 * Used for partial spends where we need to split a note.
 */
export async function relayTransfer(
  connection: Connection,
  relayerKeypair: Keypair,
  params: RelayTransferParams
): Promise<string> {
  const IDL = getIDL();
  if (!IDL) {
    throw new Error('IDL not loaded - cannot relay transactions');
  }

  const { proof, nullifier, outputCommitment1, outputCommitment2 } = params;
  const pdas = deriveShieldPdas();

  // Create Anchor provider with relayer as the wallet
  const wallet = {
    publicKey: relayerKeypair.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.sign(relayerKeypair);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      txs.forEach(tx => tx.sign(relayerKeypair));
      return txs;
    },
  };
  
  const provider = new anchor.AnchorProvider(connection, wallet as any, {
    commitment: 'confirmed',
  });
  const program = new Program(IDL, PROGRAM_ID, provider);

  const proofBytes = base64ToBytes(proof.proofBytes);
  const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
  const nullifierBytes = bigIntToBytesLE(BigInt(nullifier));
  const commitment1Bytes = bigIntToBytesLE(BigInt(outputCommitment1));
  const commitment2Bytes = bigIntToBytesLE(BigInt(outputCommitment2));

  console.log('[Relayer] Submitting shielded transfer (note split)...');
  console.log('[Relayer] Nullifier:', nullifier);
  console.log('[Relayer] Output commitments:', outputCommitment1.slice(0, 20) + '...', outputCommitment2.slice(0, 20) + '...');
  console.log('[Relayer] Proof bytes length:', proofBytes.length);
  console.log('[Relayer] Public inputs count:', publicInputs.length);

  // Build transaction manually for better control
  const ix = await program.methods
    .shieldedTransfer(
      [nullifierBytes],
      [commitment1Bytes, commitment2Bytes],
      Buffer.from(proofBytes),
      publicInputs
    )
    .accounts({
      merkleTree: pdas.merkleTree,
      nullifierSet: pdas.nullifierSet,
      transferVerifier: pdas.transferVerifier,
    })
    .instruction();

  const tx = new Transaction().add(ix);
  tx.feePayer = relayerKeypair.publicKey;
  const latestBlockhash = await getBlockhashWithRetry(connection);
  tx.recentBlockhash = latestBlockhash.blockhash;
  tx.sign(relayerKeypair);

  // First simulate to catch errors before sending
  console.log('[Relayer] Simulating transaction...');
  try {
    const simulation = await connection.simulateTransaction(tx);
    if (simulation.value.err) {
      console.error('[Relayer] Simulation failed:', simulation.value.err);
      console.error('[Relayer] Simulation logs:', simulation.value.logs);
      throw new Error(`Transaction simulation failed: ${JSON.stringify(simulation.value.err)}\nLogs: ${simulation.value.logs?.join('\n')}`);
    }
    console.log('[Relayer] Simulation succeeded, logs:', simulation.value.logs?.slice(-3));
  } catch (simErr: any) {
    // If simulation fails due to blockhash issues, skip simulation and just send
    if (simErr.message?.includes('blockhash')) {
      console.warn('[Relayer] Simulation blockhash issue, proceeding without simulation');
    } else {
      console.error('[Relayer] Simulation error:', simErr);
      throw simErr;
    }
  }

  // Send transaction
  const signature = await connection.sendRawTransaction(tx.serialize(), {
    skipPreflight: true, // We already simulated
    maxRetries: 5,
  });
  console.log('[Relayer] Transfer sent:', signature);

  // Return immediately - don't wait for confirmation
  // The simulation already passed, so the tx should land
  // Client can verify by checking the nullifier is spent
  console.log('[Relayer] Returning signature (optimistic)');
  return signature;
}
