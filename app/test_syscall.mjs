import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider } from "@coral-xyz/anchor";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load IDL
const idlPath = path.join(__dirname, "../target/idl/noctura_shield.json");
const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));

// Set up provider
const connection = new anchor.web3.Connection("https://api.testnet.solana.com", "confirmed");
const wallet = new anchor.Wallet(
  anchor.web3.Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/Users/banel/config/solana/id.json", "utf8")))
  )
);
const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
anchor.setProvider(provider);

const PROGRAM_ID = new anchor.web3.PublicKey("3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz");
const program = new Program(idl, PROGRAM_ID, provider);

// Known-good test vector from Solana SDK (cdetrio5): point * 1 = point
// This MUST work if the syscall is functioning correctly
const TEST_VECTOR = {
  // 96 bytes: 64 for point + 32 for scalar
  input: "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f60000000000000000000000000000000000000000000000000000000000000001",
  expected: "1a87b0584ce92f4593d161480614f2989035225609f08058ccfa3d0f940febe31a2f3c951f6dadcc7ee9007dff81504b0fcd6d7cf59996efdc33d92bf7f9f8f6",
  name: "cdetrio5 (point * 1 = point)"
};

// Our failing input (IC[1] * public_input)
const OUR_INPUT = {
  // 96 bytes: 64 for point + 32 for scalar  
  input: "18c9c4e1ec9265c9ae4fe681301df2166f0bd62559cc34d93342bacf50be02cd2e4a0bd358e5876d3068a6324ecc04f7114935afdbee26c7c7cece8323412df005b50da4fe2ea45492a399592a9a3575d7d351625faef13961c495922b2edaf3",
  name: "IC[1] * public_input"
};

async function testScalarMul(name, inputHex) {
  console.log(`\nTesting: ${name}`);
  console.log(`Input hex: ${inputHex}`);
  console.log(`Input length: ${inputHex.length / 2} bytes`);
  
  const inputBuffer = Buffer.from(inputHex, "hex");
  
  try {
    const tx = await program.methods
      .testScalarMul(inputBuffer)
      .accounts({})
      .simulate();
    
    console.log("SUCCESS!");
    console.log("Logs:", tx.raw);
    
    // Parse the output from logs
    for (const log of tx.raw || []) {
      if (log.startsWith("Program data:")) {
        const parts = log.replace("Program data: ", "").split(" ");
        const label = Buffer.from(parts[0], "base64").toString();
        const data = parts.length > 1 ? Buffer.from(parts[1], "base64") : null;
        if (data) {
          console.log(`  ${label}: ${data.toString("hex")}`);
        } else {
          console.log(`  ${label}`);
        }
      }
    }
    return true;
  } catch (err) {
    console.log("FAILED!");
    if (err.simulationResponse?.logs) {
      console.log("Logs:");
      for (const log of err.simulationResponse.logs) {
        console.log(" ", log);
        if (log.startsWith("Program data:")) {
          const parts = log.replace("Program data: ", "").split(" ");
          const label = Buffer.from(parts[0], "base64").toString();
          const data = parts.length > 1 ? Buffer.from(parts[1], "base64") : null;
          if (data) {
            console.log(`    -> ${label}: ${data.toString("hex")}`);
          } else {
            console.log(`    -> ${label}`);
          }
        }
      }
    }
    return false;
  }
}

async function main() {
  console.log("Testing alt_bn128_multiplication syscall on testnet...\n");
  
  // First test with known-good SDK test vector
  const test1Result = await testScalarMul(TEST_VECTOR.name, TEST_VECTOR.input);
  
  // Then test with our input
  const test2Result = await testScalarMul(OUR_INPUT.name, OUR_INPUT.input);
  
  console.log("\n=== Summary ===");
  console.log(`SDK test vector (cdetrio5): ${test1Result ? "PASS" : "FAIL"}`);
  console.log(`Our input (IC[1] * public_input): ${test2Result ? "PASS" : "FAIL"}`);
}

main().catch(console.error);
