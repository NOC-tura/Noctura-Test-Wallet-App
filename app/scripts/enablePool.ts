/**
 * Enable the shielded pool by setting reserves
 */
import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import BN from "bn.js";
import * as fs from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PROGRAM_ID = new PublicKey("3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz");

// Load IDL
const idlPath = join(__dirname, "../src/lib/idl/noctura_shield.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));

async function main() {
  const homeDir = process.env.HOME || process.env.USERPROFILE || "~";
  const keypairPath = `${homeDir}/config/solana/id.json`;
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
  const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
  
  console.log("Admin:", adminKeypair.publicKey.toBase58());
  
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const wallet = new Wallet(adminKeypair as any);
  const provider = new AnchorProvider(connection as any, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);
  
  const program = new Program(idl, PROGRAM_ID, provider);
  
  // Derive shielded pool PDA
  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from("shielded-pool")],
    PROGRAM_ID
  );
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from("global-state")],
    PROGRAM_ID
  );
  
  console.log("Shielded Pool:", shieldedPool.toBase58());
  console.log("Global State:", globalState.toBase58());
  
  // Set pool reserves - 10 SOL and 50,000 NOC
  const solReserve = new BN(10 * LAMPORTS_PER_SOL);
  const nocReserve = new BN(50_000 * 1e6);
  
  console.log("\nSetting pool reserves...");
  console.log("SOL Reserve:", 10);
  console.log("NOC Reserve:", 50000);
  
  try {
    const tx = await program.methods
      .setPoolReserves(solReserve, nocReserve)
      .accounts({
        admin: adminKeypair.publicKey,
        globalState: globalState,
        shieldedPool: shieldedPool,
      })
      .rpc();
    
    console.log("Set reserves tx:", tx);
    
    // Check the pool state
    const poolAccount = await connection.getAccountInfo(shieldedPool);
    if (poolAccount) {
      const data = poolAccount.data.slice(8);
      // Layout: admin(32) + sol_reserve(8) + noc_reserve(8) + lp_total_supply(8) + swap_fee_bps(2) + bump(1) + enabled(1)
      const solRes = new BN(data.slice(32, 40), 'le');
      const nocRes = new BN(data.slice(40, 48), 'le');
      const lpSupply = new BN(data.slice(48, 56), 'le');
      const feeBps = data.readUInt16LE(56);
      const enabled = data[59] === 1;
      
      console.log("\nPool state after:");
      console.log("  SOL Reserve:", solRes.div(new BN(LAMPORTS_PER_SOL)).toString(), "SOL");
      console.log("  NOC Reserve:", nocRes.div(new BN(1e6)).toString(), "NOC");
      console.log("  LP Supply:", lpSupply.toString());
      console.log("  Fee:", feeBps, "bps");
      console.log("  Enabled:", enabled);
    }
    
  } catch (e) {
    console.error("Error:", e);
  }
}

main().catch(console.error);
