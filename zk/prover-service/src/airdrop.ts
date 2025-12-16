import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import * as spl from '@solana/spl-token';

const splToken = spl as Record<string, any>;
import { hasWallet, registerWallet } from './storage.js';

async function ensureAssociatedTokenAccount(
  connection: Connection,
  mint: PublicKey,
  owner: PublicKey,
  payer: Keypair,
) {
  const ataAddress = splToken.getAssociatedTokenAddressSync(
    mint,
    owner,
    true,
    spl.TOKEN_PROGRAM_ID,
    spl.ASSOCIATED_TOKEN_PROGRAM_ID,
  );

  try {
    return await splToken.getAccount(connection, ataAddress, 'confirmed', spl.TOKEN_PROGRAM_ID);
  } catch (err) {
    if (
      err instanceof splToken.TokenAccountNotFoundError ||
      err instanceof splToken.TokenInvalidAccountOwnerError
    ) {
      const createIx = splToken.createAssociatedTokenAccountInstruction(
        payer.publicKey,
        ataAddress,
        owner,
        mint,
        spl.TOKEN_PROGRAM_ID,
        spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      );
      const tx = new Transaction({ feePayer: payer.publicKey }).add(createIx);
      try {
        await sendAndConfirmTransaction(connection, tx, [payer], { commitment: 'confirmed' });
      } catch (sendErr) {
        throw new Error(
          `Failed to create ATA ${ataAddress.toBase58()} for ${owner.toBase58()}: ${(sendErr as Error).message}`,
        );
      }
    } else {
      throw err;
    }
  }

  try {
    return await splToken.getAccount(connection, ataAddress, 'confirmed', spl.TOKEN_PROGRAM_ID);
  } catch (err) {
    throw new Error(
      `Failed to initialize associated token account for ${owner.toBase58()}: ${(err as Error).message}`,
    );
  }
}

export async function sendNocAirdrop(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  destination: PublicKey,
  amount: bigint,
) {
  if (hasWallet(destination.toBase58())) {
    throw new Error('Wallet has already claimed the NOC faucet');
  }

  const authorityAta = await ensureAssociatedTokenAccount(connection, mint, authority.publicKey, authority);
  const authorityBalance = BigInt(authorityAta.amount ?? 0n);
  if (authorityBalance < amount) {
    throw new Error('Faucet authority does not hold enough NOC to satisfy request');
  }
  const userAta = await ensureAssociatedTokenAccount(connection, mint, destination, authority);

  const ix = spl.createTransferInstruction(
    authorityAta.address,
    userAta.address,
    authority.publicKey,
    Number(amount),
    [],
    spl.TOKEN_PROGRAM_ID,
  );

  const tx = new Transaction({ feePayer: authority.publicKey }).add(ix);
  const signature = await sendAndConfirmTransaction(connection, tx, [authority], {
    commitment: 'confirmed',
  });

  registerWallet(destination.toBase58());
  return signature;
}
