declare module '@solana/spl-token' {
  import type { Connection, PublicKey, Signer, TransactionInstruction } from '@solana/web3.js';

  export const TOKEN_PROGRAM_ID: PublicKey;
  export const ASSOCIATED_TOKEN_PROGRAM_ID: PublicKey;

  export interface TokenAccount {
    address: PublicKey;
  }

  export function getOrCreateAssociatedTokenAccount(
    connection: Connection,
    payer: Signer,
    mint: PublicKey,
    owner: PublicKey,
  ): Promise<TokenAccount>;

  export function createTransferInstruction(
    source: PublicKey,
    destination: PublicKey,
    owner: PublicKey,
    amount: number,
    multiSigners?: Signer[],
    programId?: PublicKey,
  ): TransactionInstruction;
}
