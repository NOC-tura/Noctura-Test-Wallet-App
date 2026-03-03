// @ts-nocheck
/**
 * Initialize vault token account for a specific mint
 * Run: npx ts-node scripts/initVault.ts
 */

const { readFile } = require('fs/promises');
const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');
const anchor = require('@coral-xyz/anchor');
const IDL = require('../target/idl/noctura_shield.json');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');

const GLOBAL_STATE_SEED = Buffer.from('global-state');
const VAULT_TOKEN_SEED = Buffer.from('vault-token');
const VAULT_AUTHORITY_SEED = Buffer.from('vault-authority');

async function loadKeypair(): Promise<Keypair> {
  const keypairPath = process.env.SOLANA_KEYPAIR || process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(await readFile(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function derivePDAs(mint: PublicKey) {
  const [globalState] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
    [VAULT_TOKEN_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
  const [vaultAuthority] = PublicKey.findProgramAddressSync(
    [VAULT_AUTHORITY_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
  return { globalState, vaultTokenAccount, vaultAuthority };
}

async function main() {
  const rpcUrl = process.env.RPC_URL || 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('='.repeat(60));
  console.log('VAULT TOKEN ACCOUNT INITIALIZATION');
  console.log('='.repeat(60));
  
  console.log('\n📂 Loading admin keypair...');
  const admin = await loadKeypair();
  console.log('   Admin:', admin.publicKey.toBase58());
  
  const balance = await connection.getBalance(admin.publicKey);
  console.log('   Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  if (balance < 0.01 * LAMPORTS_PER_SOL) {
    console.error('❌ Insufficient balance for transaction');
    process.exit(1);
  }
  
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new Program(IDL as anchor.Idl, PROGRAM_ID, provider);
  
  const pdas = derivePDAs(NOC_MINT);
  console.log('\n📍 PDAs:');
  console.log('   Global State:', pdas.globalState.toBase58());
  console.log('   Vault Token Account:', pdas.vaultTokenAccount.toBase58());
  console.log('   Vault Authority:', pdas.vaultAuthority.toBase58());
  console.log('   NOC Mint:', NOC_MINT.toBase58());
  
  // Check if vault already exists
  const vaultInfo = await connection.getAccountInfo(pdas.vaultTokenAccount);
  if (vaultInfo) {
    console.log('\n✅ Vault already initialized!');
    return;
  }
  
  console.log('\n🔧 Initializing vault token account...');
  
  try {
    const tx = await program.methods
      .initTokenVault()
      .accounts({
        admin: admin.publicKey,
        globalState: pdas.globalState,
        mint: NOC_MINT,
        vaultTokenAccount: pdas.vaultTokenAccount,
        vaultAuthority: pdas.vaultAuthority,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    
    console.log('\n✅ Vault initialized successfully!');
    console.log('   Transaction:', tx);
    console.log('   Vault address:', pdas.vaultTokenAccount.toBase58());
  } catch (err) {
    console.error('❌ Failed to initialize vault:', err);
    process.exit(1);
  }
}

main().catch(console.error);
