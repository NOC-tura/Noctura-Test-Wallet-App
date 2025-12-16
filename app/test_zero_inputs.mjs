import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, Transaction } from '@solana/web3.js';
import { AnchorProvider, Program, setProvider, Wallet } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import BN from 'bn.js';

const connection = new Connection('https://api.testnet.solana.com', 'confirmed');

// Load wallet
const walletPath = process.env.HOME + '/config/solana/id.json';
const secretKey = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
const keypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
const wallet = new Wallet(keypair);
const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
setProvider(provider);

const idl = JSON.parse(fs.readFileSync('src/lib/idl/noctura_shield.json', 'utf8'));
const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const program = new Program(idl, programId, provider);

// Derive PDAs
const [globalState] = PublicKey.findProgramAddressSync([Buffer.from('global-state')], programId);
const [merkleTree] = PublicKey.findProgramAddressSync([Buffer.from('merkle-tree')], programId);
const [nullifierSet] = PublicKey.findProgramAddressSync([Buffer.from('nullifiers')], programId);
const [verifier] = PublicKey.findProgramAddressSync([Buffer.from('verifier')], programId);

// Test with zero public inputs (to see if the basic verification path works)
const proofBase64 = "BPN0T9GKkKkLhOBagJaHdPuDRwmHQRW0Hmb+PmJu/5AfQIVrEf4hbitHR9dvJiTzQ613U2AqdlOA74uEj6Jo7xPxg7fPu2zg6hiGpMdlyAq8IuSfWNzsCR2YuXWP0ZWnEozvYBnRufnm8v+ws+Cgja0CM3LfLE81fS2CrgcYk6UqhxzsxXjeC6LwD/z7adLnfY6o3IMmKHpIXCYFQBwrVwc+8mKd7rpQ1utAEJQnPN8tbR3PWhDQKhhlsmVDmWjyI8bq1G9LWxVYnK8q1+4ENEfsKHEeGrXbC/kcUozWS6cWGsdpRlsJYGeGDS9IAVbpfj5kHFcNrILa/BiBIgUSbQ==";
const proofBytes = Buffer.from(proofBase64, 'base64');

// Try with ZERO public inputs to skip the scalar multiplication
const zeroInput = new Array(32).fill(0);
const publicInputs = [[...zeroInput], [...zeroInput]];

// Create dummy commitment and nullifier
const commitment = new Array(32).fill(0);
const nullifier = new Array(32).fill(0);
const amount = new BN(10000000000);

// Mint and token accounts
const mint = new PublicKey('EvPfUBA97CWnKP6apRqmJYSzudonTCZCzH5tQZ7fk649');
const userTokenAccount = getAssociatedTokenAddressSync(mint, keypair.publicKey, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

// Get vault and fee collector
const globalStateAccount = await program.account.globalState.fetch(globalState);
const feeCollector = globalStateAccount.feeCollector;
const feeCollectorTokenAccount = getAssociatedTokenAddressSync(mint, feeCollector, false, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
const [vaultAuthority] = PublicKey.findProgramAddressSync([Buffer.from('vault-authority'), mint.toBuffer()], programId);
// Use PDA-derived vault token account
const [vaultTokenAccount] = PublicKey.findProgramAddressSync([Buffer.from('vault-token'), mint.toBuffer()], programId);

console.log('Testing with ZERO public inputs (should fail pairing but skip scalar mul)...');
console.log('Proof bytes length:', proofBytes.length);

try {
  const tx = await program.methods
    .transparentDeposit(commitment, nullifier, amount, [...proofBytes], publicInputs, false)
    .accounts({
      payer: keypair.publicKey,
      globalState,
      merkleTree,
      nullifierSet,
      verifier,
      mint,
      userTokenAccount,
      vaultTokenAccount,
      feeCollectorTokenAccount,
      vaultAuthority,
      tokenProgram: TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
      rent: SYSVAR_RENT_PUBKEY,
    })
    .simulate();
  
  console.log('Simulation result:', tx);
} catch (err) {
  console.error('Error:', err.message);
  if (err.simulationResponse) {
    console.log('Logs:', err.simulationResponse.logs?.join('\n'));
  }
}
