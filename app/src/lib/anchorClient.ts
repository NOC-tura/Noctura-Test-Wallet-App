import process from 'process';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import type { Keypair, PublicKey } from '@solana/web3.js';
import { PublicKey as SolanaPublicKey, Transaction, VersionedTransaction } from '@solana/web3.js';
import idl from './idl/noctura_shield.json';
import { connection } from './solana';
import { SHIELD_PROGRAM_ID } from './constants';

const metaEnv = ((import.meta as unknown as { env?: Record<string, string> })?.env ?? {}) as Record<string, string>;
const nodeEnv = (typeof process !== 'undefined' && process?.env ? process.env : {}) as Record<string, string>;

function readFlag(key: string): boolean {
  const raw = metaEnv[key] ?? nodeEnv[key];
  if (!raw) {
    return false;
  }
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true';
}

const programId = new SolanaPublicKey(SHIELD_PROGRAM_ID);

const encoder = new TextEncoder();

type NocturaShieldIdl = Idl & typeof idl;

type MinimalWallet = {
  publicKey: PublicKey;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  signAllTransactions<T extends Transaction | VersionedTransaction>(
    txs: T[],
  ): Promise<T[]>;
};

function signWithKeypair<T extends Transaction | VersionedTransaction>(tx: T, keypair: Keypair): T {
  if (tx instanceof Transaction) {
    tx.partialSign(keypair);
    return tx;
  }

  tx.sign([keypair]);
  return tx;
}

function keypairToWallet(keypair: Keypair): MinimalWallet {
  return {
    publicKey: keypair.publicKey,
    async signTransaction<T extends Transaction | VersionedTransaction>(tx: T) {
      return signWithKeypair(tx, keypair);
    },
    async signAllTransactions<T extends Transaction | VersionedTransaction>(txs: T[]) {
      return txs.map((tx) => signWithKeypair(tx, keypair));
    },
  };
}

export function getProgramForKeypair(keypair: Keypair): Program<NocturaShieldIdl> {
  const provider = new AnchorProvider(connection, keypairToWallet(keypair), {
    commitment: 'confirmed',
    skipPreflight: readFlag('SKIP_PREFLIGHT') || readFlag('ANCHOR_SKIP_PREFLIGHT'),
  });
  return new Program(idl as NocturaShieldIdl, programId, provider);
}

const GLOBAL_STATE_SEED = encoder.encode('global-state');
const TREE_SEED = encoder.encode('merkle-tree');
const NULLIFIER_SEED = encoder.encode('nullifiers');
const VERIFIER_SEED = encoder.encode('verifier');
const WITHDRAW_VERIFIER_SEED = encoder.encode('withdraw-verifier');
const TRANSFER_VERIFIER_SEED = encoder.encode('transfer-verifier');
const VAULT_AUTHORITY_SEED = encoder.encode('vault-authority');
const VAULT_TOKEN_SEED = encoder.encode('vault-token');

export function deriveShieldPdas(mint?: PublicKey) {
  const [globalState] = SolanaPublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], programId);
  const [merkleTree] = SolanaPublicKey.findProgramAddressSync([TREE_SEED], programId);
  const [nullifierSet] = SolanaPublicKey.findProgramAddressSync([NULLIFIER_SEED], programId);
  const [verifier] = SolanaPublicKey.findProgramAddressSync([VERIFIER_SEED], programId);
  const [withdrawVerifier] = SolanaPublicKey.findProgramAddressSync([WITHDRAW_VERIFIER_SEED], programId);
  const [transferVerifier] = SolanaPublicKey.findProgramAddressSync([TRANSFER_VERIFIER_SEED], programId);

  if (!mint) {
    return { globalState, merkleTree, nullifierSet, verifier, withdrawVerifier, transferVerifier };
  }

  const [vaultAuthority] = SolanaPublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, mint.toBuffer()],
    programId,
  );
  const [vaultTokenAccount] = SolanaPublicKey.findProgramAddressSync(
    [VAULT_TOKEN_SEED, mint.toBuffer()],
    programId,
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
