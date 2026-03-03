/**
 * Initialize vault token account for a specific mint
 * Run: node scripts/initVault.cjs
 */

const { Keypair, Connection, PublicKey, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const { Program, AnchorProvider, Wallet } = require('@coral-xyz/anchor');
const anchor = require('@coral-xyz/anchor');
const fs = require('fs');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');

const GLOBAL_STATE_SEED = Buffer.from('global-state');
const VAULT_TOKEN_SEED = Buffer.from('vault-token');
const VAULT_AUTHORITY_SEED = Buffer.from('vault-authority');

async function main() {
  const rpcUrl = 'https://api.devnet.solana.com';
  const connection = new Connection(rpcUrl, 'confirmed');
  
  console.log('='.repeat(60));
  console.log('VAULT TOKEN ACCOUNT INITIALIZATION');
  console.log('='.repeat(60));
  
  console.log('\nLoading admin keypair...');
  const keypairPath = process.env.HOME + '/config/solana/id.json';
  const secretKey = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const admin = Keypair.fromSecretKey(Uint8Array.from(secretKey));
  console.log('Admin:', admin.publicKey.toBase58());
  
  const balance = await connection.getBalance(admin.publicKey);
  console.log('Balance:', (balance / LAMPORTS_PER_SOL).toFixed(4), 'SOL');
  
  const [globalState] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  const [vaultTokenAccount] = PublicKey.findProgramAddressSync([VAULT_TOKEN_SEED, NOC_MINT.toBuffer()], PROGRAM_ID);
  const [vaultAuthority] = PublicKey.findProgramAddressSync([VAULT_AUTHORITY_SEED, NOC_MINT.toBuffer()], PROGRAM_ID);
  
  console.log('\nPDAs:');
  console.log('  Global State:', globalState.toBase58());
  console.log('  Vault Token Account:', vaultTokenAccount.toBase58());
  console.log('  Vault Authority:', vaultAuthority.toBase58());
  console.log('  NOC Mint:', NOC_MINT.toBase58());
  
  // Check if vault exists
  const vaultInfo = await connection.getAccountInfo(vaultTokenAccount);
  if (vaultInfo) {
    console.log('\n✅ Vault already initialized!');
    return;
  }
  
  console.log('\n🔧 Initializing vault token account...');
  const wallet = new Wallet(admin);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  
  const IDL = JSON.parse(fs.readFileSync('./target/idl/noctura_shield.json', 'utf-8'));
  const program = new Program(IDL, PROGRAM_ID, provider);
  
  try {
    const tx = await program.methods
      .initTokenVault()
      .accounts({
        admin: admin.publicKey,
        globalState,
        mint: NOC_MINT,
        vaultTokenAccount,
        vaultAuthority,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    
    console.log('\n✅ Vault initialized successfully!');
    console.log('  Transaction:', tx);
    console.log('  Vault address:', vaultTokenAccount.toBase58());
  } catch (err) {
    console.error('\n❌ Failed to initialize vault:', err);
    process.exit(1);
  }
}

main();
