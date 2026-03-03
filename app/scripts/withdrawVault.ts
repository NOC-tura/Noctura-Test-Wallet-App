/**
 * Withdraw NOC from legacy vault PDA and burn it
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import BN from "bn.js";
import { PublicKey, Keypair, Connection } from "@solana/web3.js";
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID, burn } from "@solana/spl-token";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Program ID
const PROGRAM_ID = new PublicKey("3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz");
const NOC_MINT = new PublicKey("FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg");
// Actual vault token account (created with legacy PDA)
const VAULT_TOKEN_ACCOUNT = new PublicKey("Dqv33MqKMLPfxWu6MMSR2ycSNVAsSVMuLiaYv88aTr21");

// Load IDL
const idlPath = join(__dirname, "../src/lib/idl/noctura_shield.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

async function main() {
  // Load keypair
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = `${homeDir}/config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log("Admin:", adminKeypair.publicKey.toBase58());
  
  // Setup connection
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(adminKeypair as any);
  const provider = new AnchorProvider(connection as any, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  
  const program = new Program(idl, PROGRAM_ID, provider);
  
  // Legacy vault authority (just "vault-authority" seed, no mint)
  const [legacyVaultAuthority] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault-authority")],
    PROGRAM_ID
  );
  console.log("Legacy Vault Authority:", legacyVaultAuthority.toBase58());
  
  // Global state PDA
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-state")],
    PROGRAM_ID
  );
  console.log("Global State:", globalState.toBase58());
  
  // Get admin token account
  const adminNocAta = await getAssociatedTokenAddress(NOC_MINT, adminKeypair.publicKey);
  
  console.log("Vault Token Account:", VAULT_TOKEN_ACCOUNT.toBase58());
  console.log("Admin NOC ATA:", adminNocAta.toBase58());
  
  // Check vault balance
  const vaultBalancePre = await connection.getTokenAccountBalance(VAULT_TOKEN_ACCOUNT);
  console.log("\nVault NOC balance:", Number(vaultBalancePre.value.amount) / 1e6);
  
  const adminBalancePre = await connection.getTokenAccountBalance(adminNocAta);
  console.log("Admin NOC balance:", Number(adminBalancePre.value.amount) / 1e6);
  
  // Amount to withdraw (50,000 NOC)
  const withdrawAmount = new BN(50_000 * 1e6);
  
  console.log("\nWithdrawing 50,000 NOC from legacy vault...");
  
  try {
    const withdrawTx = await program.methods
      .adminWithdrawLegacyVault(withdrawAmount)
      .accounts({
        admin: adminKeypair.publicKey,
        globalState: globalState,
        mint: NOC_MINT,
        legacyVaultAuthority: legacyVaultAuthority,
        vaultTokenAccount: VAULT_TOKEN_ACCOUNT,
        destination: adminNocAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([adminKeypair])
      .rpc();
    
    console.log("Withdraw tx:", withdrawTx);
    
    // Check new balances
    const vaultBalancePost = await connection.getTokenAccountBalance(VAULT_TOKEN_ACCOUNT);
    console.log("\nVault NOC after:", Number(vaultBalancePost.value.amount) / 1e6);
    
    const adminBalancePost = await connection.getTokenAccountBalance(adminNocAta);
    console.log("Admin NOC after:", Number(adminBalancePost.value.amount) / 1e6);
    
    // Burn the withdrawn tokens
    console.log("\nBurning 50,000 NOC...");
    const burnSig = await burn(
      connection,
      adminKeypair,
      adminNocAta,
      NOC_MINT,
      adminKeypair,
      50_000 * 1e6
    );
    console.log("Burn tx:", burnSig);
    
    // Final balance
    const adminFinal = await connection.getTokenAccountBalance(adminNocAta);
    console.log("\nAdmin NOC final:", Number(adminFinal.value.amount) / 1e6);
    
    // Check supply
    const supplyInfo = await connection.getTokenSupply(NOC_MINT);
    console.log("Total NOC supply:", Number(supplyInfo.value.amount) / 1e6);
    
  } catch (e) {
    console.error("Error:", e);
  }
}

main().catch(console.error);
