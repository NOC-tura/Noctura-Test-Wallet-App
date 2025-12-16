import { Buffer } from 'buffer';
import type { AnchorProvider } from '@coral-xyz/anchor';
import { Keypair, PublicKey, SYSVAR_RENT_PUBKEY, SystemProgram, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import BN from 'bn.js';
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';
import { connection } from './solana';
import { getProgramForKeypair, deriveShieldPdas } from './anchorClient';
import { PreparedDeposit } from './shield';
import { ProverResponse } from './prover';
import { NOC_TOKEN_MINT } from './constants';
import { RandomizedTiming, ANONYMITY_LEVELS, AnonymityConfig } from './anonymityUtils';

// Privacy fee: ONLY 0.25 NOC for ALL shielded transactions (deposits, withdrawals, transfers)
// This is a FIXED fee, not percentage-based. No fees in SOL or other tokens.
// This fee powers the Noctura privacy ecosystem
export const PRIVACY_FEE_ATOMS = 250_000n; // 0.25 NOC in atoms (6 decimals)

function base64ToBytes(payload: string): Uint8Array {
  if (typeof atob !== 'undefined') {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }
  const nodeBuffer = (globalThis as typeof globalThis & { Buffer?: typeof Buffer }).Buffer;
  if (nodeBuffer) {
    return Uint8Array.from(nodeBuffer.from(payload, 'base64'));
  }
  throw new Error('Base64 decoding unavailable in this environment');
}

function bigIntToBytesLE(value: bigint, length = 32): number[] {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = 0; i < length; i += 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error('Field element too large');
  }
  return Array.from(bytes);
}

function equalByteArrays(a: number[], b: number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Initialize the shield program with merkle tree and other required accounts.
 * This must be called once before any deposits can be made.
 * Only the program admin can call this.
 */
export async function initializeShieldProgram(
  adminKeypair: Keypair,
  feeCollectorAddress?: PublicKey,
): Promise<string> {
  console.log('[initializeShieldProgram] Starting shield program initialization...');
  
  const program = getProgramForKeypair(adminKeypair);
  const pdas = deriveShieldPdas();
  const admin = adminKeypair.publicKey;
  
  // Default fee collector to admin if not provided
  const feeCollector = feeCollectorAddress || admin;
  console.log('[initializeShieldProgram] Admin:', admin.toBase58());
  console.log('[initializeShieldProgram] Fee collector:', feeCollector.toBase58());
  
  try {
    // Check if already initialized
    try {
      const globalState = await program.account.globalState.fetch(pdas.globalState);
      console.log('[initializeShieldProgram] Program already initialized');
      return 'Program already initialized';
    } catch {
      console.log('[initializeShieldProgram] Program not yet initialized, proceeding with init');
    }
    
    // Call initialize instruction
    // Tree height: 14 (for 2^14 = 16K commitments) - further reduced to fit in account size
    // Fee collector: the provided address
    // Shield fee: 0 (no percentage-based fees, only fixed 0.25 NOC per transaction)
    // Priority fee: 0 (no priority fees)
    const signature = await program.methods
      .initialize(
        14, // treeHeight - allows ~16K deposits (reduced to fit account size)
        feeCollector,
        0, // shieldFeeBps - no percentage fee (only 0.25 NOC fixed fee)
        0, // priorityFeeBps - no priority fee
      )
      .accounts({
        admin,
        globalState: pdas.globalState,
        merkleTree: pdas.merkleTree,
        nullifierSet: pdas.nullifierSet,
        verifier: pdas.verifier,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    
    console.log('[initializeShieldProgram] ✅ Initialization successful, signature:', signature);
    return signature;
  } catch (err) {
    console.error('[initializeShieldProgram] Initialization failed:', err);
    throw new Error(`Failed to initialize shield program: ${(err as Error).message}`);
  }
}

/**
 * Update the shield fees to 0 basis points (no on-chain fees).
 * Only the fixed 0.25 NOC privacy fee applies.
 * Only the program admin can call this.
 * @param adminKeypair - The admin keypair
 * @returns Transaction signature
 */
export async function setShieldFees(adminKeypair: Keypair): Promise<string> {
  const program = getProgramForKeypair(adminKeypair);
  const nocMint = new PublicKey(NOC_TOKEN_MINT);
  const pdas = deriveShieldPdas(nocMint);

  console.log('[setShieldFees] Updating shield fees to 0...');
  try {
    const signature = await program.methods
      .setFee(0, 0) // Both shield fee and priority fee set to 0
      .accounts({
        admin: adminKeypair.publicKey,
        globalState: pdas.globalState,
      })
      .rpc();

    console.log('[setShieldFees] ✅ Shield fees updated successfully, signature:', signature);
    return signature;
  } catch (err) {
    console.error('[setShieldFees] Failed to update shield fees:', err);
    throw new Error(`Failed to update shield fees: ${(err as Error).message}`);
  }
}

/**
 * Update the fee collector address (admin only).
 * This is where shielded transaction privacy fees are sent.
 */
export async function setFeeCollector(adminKeypair: Keypair, newFeeCollectorAddress: PublicKey): Promise<string> {
  console.log('[setFeeCollector] Updating fee collector to:', newFeeCollectorAddress.toBase58());
  
  const program = getProgramForKeypair(adminKeypair);
  const pdas = deriveShieldPdas();
  
  try {
    const signature = await program.methods
      .setFeeCollector(newFeeCollectorAddress)
      .accounts({
        admin: adminKeypair.publicKey,
        globalState: pdas.globalState,
      })
      .rpc();

    console.log('[setFeeCollector] ✅ Fee collector updated successfully, signature:', signature);
    return signature;
  } catch (err) {
    console.error('[setFeeCollector] Failed to update fee collector:', err);
    throw new Error(`Failed to update fee collector: ${(err as Error).message}`);
  }
}

/**
 * Check if the shield program is initialized by attempting to fetch the global state.

 */
export async function isShieldProgramInitialized(): Promise<boolean> {
  try {
    const program = getProgramForKeypair(Keypair.generate());
    const pdas = deriveShieldPdas();
    await program.account.globalState.fetch(pdas.globalState);
    console.log('[isShieldProgramInitialized] ✅ Program is initialized');
    return true;
  } catch (err) {
    console.log('[isShieldProgramInitialized] ❌ Program is not initialized:', (err as Error).message);
    return false;
  }
}

export async function ensureAta(keypair: Keypair, mint: PublicKey): Promise<PublicKey> {
  const ata = getAssociatedTokenAddressSync(mint, keypair.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const info = await connection.getAccountInfo(ata);
  if (!info) {
    const ix = createAssociatedTokenAccountInstruction(
      keypair.publicKey,
      ata,
      keypair.publicKey,
      mint,
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    const program = getProgramForKeypair(keypair);
    const provider = program.provider as AnchorProvider;
    const tx = new Transaction().add(ix);
    await provider.sendAndConfirm(tx, [keypair]);
  }
  return ata;
}

/**
 * Collect the 0.25 NOC privacy fee for shielded transactions.
 * This fee is collected in NOC regardless of which token is being transferred.
 * @returns The transaction signature
 */
export async function collectPrivacyFee(keypair: Keypair): Promise<string> {
  const nocMint = new PublicKey(NOC_TOKEN_MINT);
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas(nocMint);
  
  console.log('[collectPrivacyFee] Starting privacy fee collection...');
  console.log('[collectPrivacyFee] Payer:', keypair.publicKey.toBase58());
  console.log('[collectPrivacyFee] Fee amount (atoms):', PRIVACY_FEE_ATOMS.toString());
  
  // Always use creator address as fee collector for privacy fee
  const feeCollectorOwner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
  
  console.log('[collectPrivacyFee] Fee collector owner:', feeCollectorOwner.toBase58());
  
  // User's NOC token account
  const userNocAccount = getAssociatedTokenAddressSync(
    nocMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  
  console.log('[collectPrivacyFee] User NOC account:', userNocAccount.toBase58());
  
  // Fee collector's NOC token account
  const feeCollectorNocAccount = getAssociatedTokenAddressSync(
    nocMint,
    feeCollectorOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  
  console.log('[collectPrivacyFee] Fee collector NOC account:', feeCollectorNocAccount.toBase58());
  
  // Ensure fee collector's NOC account exists
  const feeCollectorInfo = await connection.getAccountInfo(feeCollectorNocAccount);
  const provider = program.provider as AnchorProvider;
  
  const tx = new Transaction();
  
  if (!feeCollectorInfo) {
    // Create the fee collector's ATA if it doesn't exist
    console.log('[collectPrivacyFee] Fee collector ATA does not exist, creating...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        feeCollectorNocAccount,
        feeCollectorOwner,
        nocMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
  } else {
    console.log('[collectPrivacyFee] Fee collector ATA already exists');
  }
  
  // Add the transfer instruction for the 0.25 NOC fee
  console.log('[collectPrivacyFee] Adding fee transfer instruction...');
  tx.add(
    createTransferInstruction(
      userNocAccount,
      feeCollectorNocAccount,
      keypair.publicKey,
      Number(PRIVACY_FEE_ATOMS),
      [],
      TOKEN_PROGRAM_ID,
    )
  );
  
  try {
    console.log('[collectPrivacyFee] Sending transaction to blockchain...');
    const signature = await provider.sendAndConfirm(tx, [keypair]);
    console.log('[collectPrivacyFee] ✅ Privacy fee collected successfully:', signature);
    console.log('[collectPrivacyFee] Fee of 0.25 NOC deducted from user account');
    return signature;
  } catch (err) {
    console.error('[collectPrivacyFee] ❌ FAILED to collect privacy fee:', err);
    throw new Error(`Failed to collect privacy fee: ${(err as Error).message}`);
  }
}

export async function submitShieldedDeposit(params: {
  keypair: Keypair;
  prepared: PreparedDeposit;
  proof: ProverResponse;
  priorityLane?: boolean;
  mint?: PublicKey;  // Optional mint, defaults to NOC
  tokenType?: 'SOL' | 'NOC';  // Token type for logging
}) {
  try {
    const { keypair, prepared, proof, priorityLane = false, mint: mintParam, tokenType = 'NOC' } = params;
    if (prepared.note.amount <= 0n) {
      throw new Error('Prepared deposit amount must be greater than zero');
    }
    
    // For native SOL, we don't use a token mint - transfer happens via SystemProgram
    // For NOC, we use the token program with NOC_TOKEN_MINT
    const isNativeSOL = tokenType === 'SOL';
    const mint = isNativeSOL ? null : (mintParam || new PublicKey(NOC_TOKEN_MINT));
    let solDepositSig: string | undefined; // Store SOL deposit signature
    
    console.log('[submitShieldedDeposit] Starting deposit submission:', {
      mint: mint?.toBase58() || 'Native SOL',
      amount: prepared.note.amount.toString(),
      tokenType,
      isNativeSOL,
    });

    // For native SOL, collect the privacy fee first, then transfer SOL to the vault
    if (isNativeSOL) {
      console.log('[submitShieldedDeposit] Processing native SOL deposit...');

      // Collect 0.25 NOC privacy fee for SOL deposits as well
      console.log('[submitShieldedDeposit] Collecting 0.25 NOC privacy fee (SOL)...');
      try {
        const feeSig = await collectPrivacyFee(keypair);
        console.log('[submitShieldedDeposit] ✅ Privacy fee collected (SOL), signature:', feeSig);
      } catch (feeErr) {
        console.error('[submitShieldedDeposit] ❌ Privacy fee collection failed (SOL):', feeErr);
        throw new Error(`Privacy fee collection failed: ${(feeErr as Error).message}`);
      }

      // The vault for SOL is a system account (PDA), not a token account
      const program = getProgramForKeypair(keypair);
      const [solVaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('sol-vault')],
        program.programId
      );
      console.log('[submitShieldedDeposit] SOL vault PDA:', solVaultPda.toBase58());

      // Transfer native SOL to the vault
      const transferIx = SystemProgram.transfer({
        fromPubkey: keypair.publicKey,
        toPubkey: solVaultPda,
        lamports: Number(prepared.note.amount),
      });
      const tx = new Transaction().add(transferIx);
      solDepositSig = await sendAndConfirmTransaction(connection, tx, [keypair]);
      console.log('[submitShieldedDeposit] ✅ Native SOL transferred to vault:', solDepositSig);
      // Wait for confirmation
      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    // Use NOC_TOKEN_MINT for deriving PDAs (shared infrastructure for all deposits)
    const pdaMint = new PublicKey(NOC_TOKEN_MINT);
    const program = getProgramForKeypair(keypair);
    const pdas = deriveShieldPdas(pdaMint);

    
    console.log('[submitShieldedDeposit] PDAs derived:', {
      globalState: pdas.globalState.toBase58(),
      merkleTree: pdas.merkleTree.toBase58(),
      vaultTokenAccount: pdas.vaultTokenAccount?.toBase58(),
      vaultAuthority: pdas.vaultAuthority?.toBase58(),
    });

    const [treeAccount, globalStateAccount] = await Promise.all([
      program.account.merkleTreeAccount.fetch(pdas.merkleTree),
      program.account.globalState.fetch(pdas.globalState),
    ]);
    const leafIndex = Number(treeAccount.currentIndex);
    console.log('[submitShieldedDeposit] Fetched tree and global state, leafIndex:', leafIndex);
    
    // Disable on-chain shield/priority fees if they are non-zero (only client-side 0.25 NOC fee should apply)
    const shieldFeeBps: number = (globalStateAccount as any).shieldFeeBps ?? 0;
    const priorityFeeBps: number = (globalStateAccount as any).priorityFeeBps ?? 0;

    if (shieldFeeBps !== 0 || priorityFeeBps !== 0) {
      console.log('[submitShieldedDeposit] On-chain fees are non-zero, disabling to ensure only 0.25 NOC privacy fee is charged...');
      try {
        await program.methods
          .setFee(0, 0)
          .accounts({
            admin: keypair.publicKey,
            globalState: pdas.globalState,
          })
          .rpc();
        console.log('[submitShieldedDeposit] ✅ On-chain fees disabled (set to 0 bps)');
      } catch (feeErr) {
        console.warn('[submitShieldedDeposit] ⚠️ Failed to disable on-chain fees (continuing with deposit):', (feeErr as Error).message);
      }
    }

    // For native SOL, we already transferred the funds and collected fee
    if (isNativeSOL) {
      console.log('[submitShieldedDeposit] ✅ Native SOL deposit complete (fee collected, no token program needed)');
      if (!solDepositSig) {
        throw new Error('SOL deposit signature is missing');
      }
      return { signature: solDepositSig, leafIndex };
    }
    
    // For NOC deposits, use the provided mint or default to NOC_TOKEN_MINT
    const nocMint = mint || pdaMint;

    // Collect 0.25 NOC privacy fee for deposit (same fee for all shielded transactions)
    console.log('[submitShieldedDeposit] Collecting 0.25 NOC privacy fee...');
    try {
      const feeSig = await collectPrivacyFee(keypair);
      console.log('[submitShieldedDeposit] ✅ Privacy fee collected, signature:', feeSig);
    } catch (feeErr) {
      console.error('[submitShieldedDeposit] ❌ CRITICAL: Privacy fee collection failed:', feeErr);
      throw new Error(`Privacy fee collection failed: ${(feeErr as Error).message}`);
    }

    const userTokenAccount = await ensureAta(keypair, nocMint);
    console.log('[submitShieldedDeposit] User token account ensured:', userTokenAccount.toBase58());

    // Use on-chain fee collector for deposit accounts to satisfy program constraints
    const feeCollectorOwner = new PublicKey(
      (globalStateAccount as { feeCollector: PublicKey | string }).feeCollector,
    );
    const feeCollectorTokenAccount = getAssociatedTokenAddressSync(
      nocMint,
      feeCollectorOwner,
      true,  // allowOwnerOffCurve - in case fee collector is a PDA
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID,
    );
    
    // Ensure fee collector's token account exists (user pays to create if needed)
    try {
      console.log('[submitShieldedDeposit] Checking fee collector ATA:', feeCollectorTokenAccount.toBase58());
      const feeCollectorAtaInfo = await connection.getAccountInfo(feeCollectorTokenAccount);
      if (!feeCollectorAtaInfo) {
        console.log('[submitShieldedDeposit] Fee collector ATA does not exist, creating...');
        const createAtaIx = createAssociatedTokenAccountInstruction(
          keypair.publicKey,
          feeCollectorTokenAccount,
          feeCollectorOwner,
          nocMint,
          TOKEN_PROGRAM_ID,
          ASSOCIATED_TOKEN_PROGRAM_ID,
        );
        const provider = program.provider as AnchorProvider;
        const tx = new Transaction().add(createAtaIx);
        const sig = await provider.sendAndConfirm(tx, [keypair]);
        console.log('[submitShieldedDeposit] Created fee collector ATA, signature:', sig);
        // Wait a bit for the account to be confirmed
        await new Promise(resolve => setTimeout(resolve, 2000));
        console.log('[submitShieldedDeposit] Fee collector ATA created and confirmed');
      } else {
        console.log('[submitShieldedDeposit] Fee collector ATA already exists');
      }
    } catch (err) {
      console.error('[submitShieldedDeposit] Error creating fee collector ATA:', err);
      throw new Error(`Failed to create fee collector token account: ${(err as Error).message}`);
    }
    
    const proofBytes = base64ToBytes(proof.proofBytes);
    const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
    const expectedInputs = prepared.publicInputsBytes.map((entry) => Array.from(entry));
    
    console.log('[submitShieldedDeposit] Validating proof:', {
      publicInputsLength: publicInputs.length,
      expectedInputsLength: expectedInputs.length,
    });

    if (expectedInputs.length !== publicInputs.length) {
      throw new Error(`Prover returned ${publicInputs.length} public inputs, expected ${expectedInputs.length}`);
    }
    const mismatchIndex = expectedInputs.findIndex((expected, idx) => !equalByteArrays(expected, publicInputs[idx]));
    if (mismatchIndex !== -1) {
      throw new Error(`Public input mismatch at index ${mismatchIndex}`);
    }

    const commitment = bigIntToBytesLE(BigInt(prepared.note.commitment));
    const nullifier = bigIntToBytesLE(BigInt(prepared.note.nullifier));
    const amount = new BN(prepared.note.amount.toString());

    console.log('[submitShieldedDeposit] Building transaction with accounts:', {
      payer: keypair.publicKey.toBase58(),
      mint: nocMint.toBase58(),
      userTokenAccount: userTokenAccount.toBase58(),
      vaultTokenAccount: pdas.vaultTokenAccount!.toBase58(),
      feeCollectorTokenAccount: feeCollectorTokenAccount.toBase58(),
      vaultAuthority: pdas.vaultAuthority!.toBase58(),
    });

    const signature = await program.methods
      .transparentDeposit(commitment, nullifier, amount, Buffer.from(proofBytes), publicInputs, priorityLane)
      .accounts({
        payer: keypair.publicKey,
        globalState: pdas.globalState,
        merkleTree: pdas.merkleTree,
        nullifierSet: pdas.nullifierSet,
        verifier: pdas.verifier,
        mint: nocMint,
        userTokenAccount,
        vaultTokenAccount: pdas.vaultTokenAccount!,
        feeCollectorTokenAccount,
        vaultAuthority: pdas.vaultAuthority!,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();

    console.log('[submitShieldedDeposit] Deposit transaction submitted successfully:', signature);
    return { signature, leafIndex };
  } catch (err) {
    console.error('[submitShieldedDeposit] Error during deposit submission:', err);
    throw err;
  }
}

export async function submitShieldedWithdraw(params: {
  keypair: Keypair;
  proof: ProverResponse;
  amount: bigint;
  targetAta: PublicKey;
  nullifier: bigint;
  mint?: PublicKey; // Optional mint, defaults to NOC
  recipient?: PublicKey; // Recipient pubkey (for ATA creation if needed)
  anonymityConfig?: AnonymityConfig; // Optional anonymity settings
}) {
  const { keypair, proof, amount, targetAta, nullifier, mint: mintParam, recipient, anonymityConfig } = params;
  if (amount <= 0n) {
    throw new Error('Withdrawal amount must be greater than zero');
  }
  
  // Apply randomized timing if anonymity is enabled
  if (anonymityConfig?.enableRandomizedTiming) {
    const delay = RandomizedTiming.getRandomDelay(anonymityConfig);
    if (delay > 0) {
      console.log(`[submitShieldedWithdraw] Applying ${delay}ms randomized delay for privacy...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  // Use the provided mint, or default to NOC_TOKEN_MINT
  const mint = mintParam || new PublicKey(NOC_TOKEN_MINT);
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas(mint);
  
  // Collect 0.25 NOC privacy fee for withdrawal
  console.log('[submitShieldedWithdraw] Collecting 0.25 NOC privacy fee for withdrawal...');
  try {
    const feeSig = await collectPrivacyFee(keypair);
    console.log('[submitShieldedWithdraw] ✅ Privacy fee collected, signature:', feeSig);
  } catch (feeErr) {
    console.error('[submitShieldedWithdraw] ❌ CRITICAL: Privacy fee collection failed:', feeErr);
    throw new Error(`Privacy fee collection failed: ${(feeErr as Error).message}`);
  }
  
  // Check if target ATA exists, create if needed
  const ataInfo = await connection.getAccountInfo(targetAta);
  if (!ataInfo) {
    // Use provided recipient or default to keypair.publicKey
    const ataOwner = recipient || keypair.publicKey;
    console.log('Creating recipient ATA for mint:', mint.toBase58(), 'owner:', ataOwner.toBase58());
    const createAtaIx = createAssociatedTokenAccountInstruction(
      keypair.publicKey, // payer
      targetAta,         // ata to create
      ataOwner,          // owner (recipient)
      mint,              // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    const tx = new Transaction().add(createAtaIx);
    const { blockhash } = await connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = keypair.publicKey;
    tx.sign(keypair);
    const createSig = await connection.sendRawTransaction(tx.serialize());
    await connection.confirmTransaction(createSig, 'confirmed');
    console.log('Created ATA:', createSig);
  }

  const proofBytes = base64ToBytes(proof.proofBytes);
  const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
  const nullifierBytes = bigIntToBytesLE(nullifier);
  const amountBn = new BN(amount.toString());

  const signature = await program.methods
    .transparentWithdraw(amountBn, Buffer.from(proofBytes), publicInputs, nullifierBytes)
    .accounts({
      globalState: pdas.globalState,
      nullifierSet: pdas.nullifierSet,
      withdrawVerifier: pdas.withdrawVerifier,
      mint: mint,
      vaultTokenAccount: pdas.vaultTokenAccount!,
      receiverTokenAccount: targetAta,
      vaultAuthority: pdas.vaultAuthority!,
      tokenProgram: TOKEN_PROGRAM_ID,
    })
    .rpc();

  return signature;
}

// Shielded withdrawal for native SOL: withdraw from SOL vault to recipient
// Combines privacy fee collection and SOL withdrawal in a single transaction
export async function submitShieldedWithdrawSol(params: {
  keypair: Keypair;
  proof: ProverResponse;
  amount: bigint;
  recipient: PublicKey; // Recipient wallet address for native SOL
  nullifier: bigint;
}) {
  const { keypair, proof, amount, recipient, nullifier } = params;
  if (amount <= 0n) {
    throw new Error('Withdrawal amount must be greater than zero');
  }
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas();
  const provider = program.provider as AnchorProvider;

  // Prepare proof data
  const proofBytes = base64ToBytes(proof.proofBytes);
  const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
  const nullifierBytes = bigIntToBytesLE(nullifier);
  const amountBn = new BN(amount.toString());

  // Derive SOL vault PDA
  const [solVaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('sol-vault')],
    program.programId
  );
  console.log('[submitShieldedWithdrawSol] SOL vault PDA:', solVaultPda.toBase58());
  console.log('[submitShieldedWithdrawSol] Recipient:', recipient.toBase58());

  // Build transaction combining fee collection + SOL withdrawal
  const tx = new Transaction();

  // Step 1: Add privacy fee collection instruction (0.25 NOC from user to fee collector)
  const nocMint = new PublicKey(NOC_TOKEN_MINT);
  const feeCollectorOwner = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
  
  const userNocAccount = getAssociatedTokenAddressSync(
    nocMint,
    keypair.publicKey,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  
  const feeCollectorNocAccount = getAssociatedTokenAddressSync(
    nocMint,
    feeCollectorOwner,
    false,
    TOKEN_PROGRAM_ID,
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  // Check if fee collector's NOC account exists, create if needed
  const feeCollectorInfo = await connection.getAccountInfo(feeCollectorNocAccount);
  if (!feeCollectorInfo) {
    console.log('[submitShieldedWithdrawSol] Creating fee collector NOC account...');
    tx.add(
      createAssociatedTokenAccountInstruction(
        keypair.publicKey,
        feeCollectorNocAccount,
        feeCollectorOwner,
        nocMint,
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID,
      )
    );
  }

  // Add fee transfer (0.25 NOC)
  console.log('[submitShieldedWithdrawSol] Adding privacy fee instruction (0.25 NOC)...');
  tx.add(
    createTransferInstruction(
      userNocAccount,
      feeCollectorNocAccount,
      keypair.publicKey,
      Number(PRIVACY_FEE_ATOMS),
      [],
      TOKEN_PROGRAM_ID,
    )
  );

  // Step 2: Add SOL withdrawal instruction (from shielded vault)
  console.log('[submitShieldedWithdrawSol] Adding SOL withdrawal instruction...');
  const withdrawIx = await program.methods
    .transparentWithdrawSol(amountBn, Buffer.from(proofBytes), publicInputs, nullifierBytes)
    .accounts({
      globalState: pdas.globalState,
      nullifierSet: pdas.nullifierSet,
      withdrawVerifier: pdas.withdrawVerifier,
      solVault: solVaultPda,
      recipient: recipient,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  tx.add(withdrawIx);

  // Send combined transaction
  console.log('[submitShieldedWithdrawSol] Sending combined transaction (fee + withdrawal)...');
  try {
    const signature = await provider.sendAndConfirm(tx, [keypair]);
    console.log('[submitShieldedWithdrawSol] ✅ Combined transaction succeeded:', signature);
    return signature;
  } catch (err) {
    const errMsg = (err as Error).message;
    
    // If transparentWithdrawSol not found, provide helpful message
    if (errMsg.includes('transparentWithdrawSol') || errMsg.includes('Fallback functions') || errMsg.includes('InstructionFallbackNotFound')) {
      console.error('[submitShieldedWithdrawSol] ❌ transparentWithdrawSol not deployed yet on-chain');
      throw new Error('Direct SOL withdrawal not yet available on this network. Please use the transparent mode to transfer SOL between your regular wallets, or deposit to shielded vault via transparent mode first.');
    }
    
    console.error('[submitShieldedWithdrawSol] ❌ Combined transaction failed:', err);
    throw new Error(`Shielded SOL withdrawal failed: ${(err as Error).message}`);
  }
}

// Shielded transfer: spend one note, create two new notes (recipient + change)
// Used for splitting notes (partial spends). The actual withdrawal to recipient
// is done via submitShieldedWithdraw.
// NOTE: Privacy fee (0.25 NOC) is collected for ALL shielded transactions
export async function submitShieldedTransfer(params: {
  keypair: Keypair;
  proof: ProverResponse;
  nullifier: bigint;
  outputCommitment1: bigint;
  outputCommitment2: bigint;
}) {
  const { keypair, proof, nullifier, outputCommitment1, outputCommitment2 } = params;
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas();

  // Collect 0.25 NOC privacy fee for shielded transfer (note split)
  console.log('[submitShieldedTransfer] Collecting 0.25 NOC privacy fee for shielded transfer...');
  try {
    const feeSig = await collectPrivacyFee(keypair);
    console.log('[submitShieldedTransfer] ✅ Privacy fee collected, signature:', feeSig);
  } catch (feeErr) {
    console.error('[submitShieldedTransfer] ❌ CRITICAL: Privacy fee collection failed:', feeErr);
    throw new Error(`Privacy fee collection failed: ${(feeErr as Error).message}`);
  }

  const proofBytes = base64ToBytes(proof.proofBytes);
  const publicInputs = proof.publicInputs.map((entry) => Array.from(base64ToBytes(entry)) as [number, ...number[]]);
  const nullifierBytes = bigIntToBytesLE(nullifier);
  const commitment1Bytes = bigIntToBytesLE(outputCommitment1);
  const commitment2Bytes = bigIntToBytesLE(outputCommitment2);

  const signature = await program.methods
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
    .rpc();

  return signature;
}

/**
 * Fetch spent nullifiers from on-chain state.
 * Returns an array of nullifier hashes (as hex strings) that have been spent.
 */
export async function fetchSpentNullifiers(keypair: Keypair): Promise<string[]> {
  const program = getProgramForKeypair(keypair);
  const pdas = deriveShieldPdas();
  
  try {
    const nullifierSetAccount = await program.account.nullifierSetAccount.fetch(pdas.nullifierSet);
    const nullifiers = (nullifierSetAccount as { nullifiers: number[][] }).nullifiers;
    
    // Convert each nullifier (32-byte array) to a hex string for comparison
    return nullifiers.map((nullifier: number[]) => {
      // Convert byte array to bigint (little-endian) then to string
      let value = 0n;
      for (let i = nullifier.length - 1; i >= 0; i--) {
        value = (value << 8n) | BigInt(nullifier[i]);
      }
      return value.toString();
    });
  } catch (err) {
    console.error('Failed to fetch nullifiers:', err);
    return [];
  }
}

/**
 * Check if a specific nullifier has been spent on-chain.
 */
export async function isNullifierSpent(keypair: Keypair, nullifier: string): Promise<boolean> {
  const spentNullifiers = await fetchSpentNullifiers(keypair);
  return spentNullifiers.includes(nullifier);
}

/**
 * Decode a transaction to identify if it's a shielded operation and extract amounts.
 * Returns information about the transaction if it's a shielded operation, null otherwise.
 */
export async function decodeShieldedTransaction(
  signature: string,
): Promise<{
  type: 'deposit' | 'transfer' | 'withdrawal' | null;
  mint: string | null;
  tokenType: 'SOL' | 'NOC' | null;
} | null> {
  try {
    const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx || !tx.transaction) return null;

    const { message } = tx.transaction;
    const shieldProgramId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
    const accountKeys = message.getAccountKeys({ accountKeysFromLookups: tx.meta?.loadedAddresses });
    
    // Check if this transaction calls the shield program
    const hasShieldProgram = message.compiledInstructions.some((ix) => {
      const programId = accountKeys.get(Number(ix.programIdIndex));
      return programId?.equals(shieldProgramId);
    });

    if (!hasShieldProgram) return null;

    // Simple heuristic: check for known token accounts to determine token type
    const nocMint = new PublicKey('token_address_here'); // Would need actual NOC mint
    const wsolMint = new PublicKey('So11111111111111111111111111111111111111112');
    
    // This is a simplified version - in production you'd parse the instruction data
    // For now, return that it's a shielded operation
    return {
      type: 'deposit', // Would need instruction parsing to determine actual type
      mint: null,
      tokenType: null,
    };
  } catch (err) {
    console.error('Failed to decode transaction:', err);
    return null;
  }
}

/**
 * Attempt to recover shielded notes from blockchain by fetching the merkle tree.
 * This is a recovery function if notes are missing from localStorage.
 */
export async function recoverShieldedNotesFromBlockchain(
  keypair: Keypair,
): Promise<Array<{ commitment: string; leafIndex: number; signature: string }>> {
  try {
    const program = getProgramForKeypair(keypair);
    const pdas = deriveShieldPdas();
    
    console.log('[recoverShieldedNotesFromBlockchain] Fetching merkle tree account...');
    const treeAccount = await program.account.merkleTreeAccount.fetch(pdas.merkleTree);
    const tree = (treeAccount as { commitments: Uint8Array[] }).commitments || [];
    
    console.log('[recoverShieldedNotesFromBlockchain] Found', tree.length, 'commitments on-chain');
    
    // Fetch all transactions involving the shield program to match them with commitments
    const signatures = await connection.getSignaturesForAddress(
      new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz'),
      { limit: 100 },
    );
    
    const recoveredNotes = signatures.map((sig, index) => ({
      commitment: `recovered_${index}`,
      leafIndex: index,
      signature: sig.signature,
    }));
    
    console.log('[recoverShieldedNotesFromBlockchain] Recovered', recoveredNotes.length, 'potential notes');
    return recoveredNotes;
  } catch (err) {
    console.error('[recoverShieldedNotesFromBlockchain] Failed to recover notes:', err);
    return [];
  }
}

// ============================================================================
// Verifier Key Upload Functions
// ============================================================================

function bigintToBytesBE(value: bigint, length = 32): Uint8Array {
  const bytes = new Uint8Array(length);
  let temp = value;
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  if (temp !== 0n) {
    throw new Error(`Field element ${value} does not fit in ${length} bytes`);
  }
  return bytes;
}

interface VerifierKey {
  protocol: string;
  curve: string;
  nPublic: number;
  vk_alpha_1: [string, string, string];
  vk_beta_2: [[string, string], [string, string], [string]];
  vk_gamma_2: [[string, string], [string, string], [string]];
  vk_delta_2: [[string, string], [string, string], [string]];
  IC: [string, string, string][];
}

function serializeG1Point(point: [string, string, string]): Uint8Array {
  const x = bigintToBytesBE(BigInt(point[0]));
  const y = bigintToBytesBE(BigInt(point[1]));
  const result = new Uint8Array(64);
  result.set(x, 0);
  result.set(y, 32);
  return result;
}

function serializeG2Point(point: [[string, string], [string, string], [string]]): Uint8Array {
  const xc0 = bigintToBytesBE(BigInt(point[0][0]));
  const xc1 = bigintToBytesBE(BigInt(point[0][1]));
  const yc0 = bigintToBytesBE(BigInt(point[1][0]));
  const yc1 = bigintToBytesBE(BigInt(point[1][1]));
  
  const result = new Uint8Array(128);
  result.set(xc1, 0);
  result.set(xc0, 32);
  result.set(yc1, 64);
  result.set(yc0, 96);
  return result;
}

function serializeVerifierKey(vkey: VerifierKey): Buffer {
  console.log(`[serializeVerifierKey] Serializing with ${vkey.IC.length} IC points`);
  
  const alpha = serializeG1Point(vkey.vk_alpha_1);
  const beta = serializeG2Point(vkey.vk_beta_2);
  const gamma = serializeG2Point(vkey.vk_gamma_2);
  const delta = serializeG2Point(vkey.vk_delta_2);
  
  const icPoints = vkey.IC.map(point => serializeG1Point(point));
  const icCount = new Uint8Array(4);
  new DataView(icCount.buffer).setUint32(0, vkey.IC.length, true);
  
  const totalSize = 64 + 128 + 128 + 128 + 4 + (64 * vkey.IC.length);
  const packed = new Uint8Array(totalSize);
  let offset = 0;
  
  packed.set(alpha, offset); offset += 64;
  packed.set(beta, offset); offset += 128;
  packed.set(gamma, offset); offset += 128;
  packed.set(delta, offset); offset += 128;
  packed.set(icCount, offset); offset += 4;
  
  for (const icPoint of icPoints) {
    packed.set(icPoint, offset);
    offset += 64;
  }
  
  console.log(`[serializeVerifierKey] Serialized: ${packed.length} bytes`);
  return Buffer.from(packed);
}

export async function uploadVerifierKeys(
  adminKeypair: Keypair,
  depositVkey: VerifierKey,
  withdrawVkey: VerifierKey,
  transferVkey: VerifierKey,
): Promise<{ deposit: string; withdraw: string; transfer: string }> {
  console.log('[uploadVerifierKeys] Starting verifier key upload...');
  
  const program = getProgramForKeypair(adminKeypair);
  const pdas = deriveShieldPdas();
  
  const depositBytes = serializeVerifierKey(depositVkey);
  const withdrawBytes = serializeVerifierKey(withdrawVkey);
  const transferBytes = serializeVerifierKey(transferVkey);
  
  console.log('[uploadVerifierKeys] Uploading deposit verifier...');
  const depositSig = await program.methods
    .setVerifier(depositBytes)
    .accounts({
      admin: adminKeypair.publicKey,
      globalState: pdas.globalState,
      verifier: pdas.verifier,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('[uploadVerifierKeys] ✅ Deposit verifier:', depositSig);
  
  console.log('[uploadVerifierKeys] Uploading withdraw verifier...');
  const withdrawSig = await program.methods
    .setWithdrawVerifier(withdrawBytes)
    .accounts({
      admin: adminKeypair.publicKey,
      globalState: pdas.globalState,
      withdrawVerifier: pdas.withdrawVerifier,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('[uploadVerifierKeys] ✅ Withdraw verifier:', withdrawSig);
  
  console.log('[uploadVerifierKeys] Uploading transfer verifier...');
  const transferSig = await program.methods
    .setTransferVerifier(transferBytes)
    .accounts({
      admin: adminKeypair.publicKey,
      globalState: pdas.globalState,
      transferVerifier: pdas.transferVerifier,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log('[uploadVerifierKeys] ✅ Transfer verifier:', transferSig);
  
  return {
    deposit: depositSig,
    withdraw: withdrawSig,
    transfer: transferSig,
  };
}

/**
 * Relayer client functions for submitting shielded transactions via relayer for privacy
 */

export async function relayTransfer(params: {
  proof: ProverResponse;
  nullifier: string;
  outputCommitment1: string;
  outputCommitment2: string;
}): Promise<{ signature: string }> {
  console.log('[relayTransfer] Submitting shielded transfer via relayer...');
  
  try {
    // Call relayer endpoint to submit the transfer
    const response = await fetch('http://localhost:8787/relay/transfer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: params.proof.proofBytes,
        publicInputs: params.proof.publicInputs,
        nullifier: params.nullifier,
        outputCommitment1: params.outputCommitment1,
        outputCommitment2: params.outputCommitment2,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Relayer error: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('[relayTransfer] ✅ Transfer relayed successfully:', result.signature);
    return result;
  } catch (err) {
    console.error('[relayTransfer] ❌ Relayer call failed:', err);
    throw err;
  }
}

export async function relayWithdraw(params: {
  proof: ProverResponse;
  amount: string;
  nullifier: string;
  recipientAta: string;
  mint: string;
  collectFee?: boolean;
}): Promise<{ signature: string }> {
  console.log('[relayWithdraw] Submitting shielded withdrawal via relayer...');
  
  try {
    // Call relayer endpoint to submit the withdrawal
    const response = await fetch('http://localhost:8787/relay/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        proof: params.proof.proofBytes,
        publicInputs: params.proof.publicInputs,
        amount: params.amount,
        nullifier: params.nullifier,
        recipientAta: params.recipientAta,
        mint: params.mint,
        collectFee: params.collectFee,
      }),
    });
    
    if (!response.ok) {
      throw new Error(`Relayer error: ${response.statusText}`);
    }
    
    const result = await response.json();
    console.log('[relayWithdraw] ✅ Withdrawal relayed successfully:', result.signature);
    return result;
  } catch (err) {
    console.error('[relayWithdraw] ❌ Relayer call failed:', err);
    throw err;
  }
}

/**
 * Helper: Submit shielded transaction with privacy-aware timing.
 * Applies randomized delays and anonymity features automatically.
 */
export async function submitShieldedTransactionWithPrivacy<T>(params: {
  transaction: () => Promise<T>;
  anonymityLevel?: 'minimal' | 'standard' | 'enhanced';
  description: string;
}): Promise<T> {
  const { transaction, anonymityLevel = 'standard', description } = params;
  const config = ANONYMITY_LEVELS[anonymityLevel];
  
  console.log(`[${description}] Starting with ${anonymityLevel} anonymity level`);
  
  // Apply pre-transaction delay
  await RandomizedTiming.sleep(config);
  
  // Execute transaction
  const result = await transaction();
  
  console.log(`[${description}] ✅ Privacy-aware transaction completed`);
  return result;
}

/**
 * Helper: Get recommended anonymity level based on transaction context.
 */
export function getPrivacyRecommendation(context: {
  amount: bigint;
  frequency?: 'rare' | 'occasional' | 'frequent';
  riskProfile?: 'conservative' | 'moderate' | 'aggressive';
}): AnonymityConfig {
  const largeAmount = BigInt('500000000'); // 500 SOL equivalent
  const isLargeAmount = context.amount >= largeAmount;
  const frequency = context.frequency || 'occasional';
  const riskProfile = context.riskProfile || 'moderate';

  if (riskProfile === 'aggressive' || isLargeAmount) {
    console.log('[Privacy] Large/frequent transaction detected - recommending ENHANCED privacy');
    return ANONYMITY_LEVELS.enhanced;
  } else if (riskProfile === 'moderate' || frequency === 'frequent') {
    console.log('[Privacy] Regular transaction detected - recommending STANDARD privacy');
    return ANONYMITY_LEVELS.standard;
  } else {
    console.log('[Privacy] Infrequent/small transaction - MINIMAL privacy sufficient');
    return ANONYMITY_LEVELS.minimal;
  }
}

