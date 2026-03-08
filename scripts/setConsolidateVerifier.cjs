const anchor = require('@coral-xyz/anchor');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const RPC = 'https://api.devnet.solana.com';

// Constants for BN128 curve
const G1_BYTES = 64; // 2 x 32 bytes (x, y)
const G2_BYTES = 128; // 4 x 32 bytes (x.c1, x.c0, y.c1, y.c0)

function bigintToBytesBE(value, length = 32) {
  const bytes = new Uint8Array(length);
  let temp = BigInt(value);
  for (let i = length - 1; i >= 0; i -= 1) {
    bytes[i] = Number(temp & 0xffn);
    temp >>= 8n;
  }
  return bytes;
}

function serializeG1Point(point) {
  const x = bigintToBytesBE(BigInt(point[0]));
  const y = bigintToBytesBE(BigInt(point[1]));
  const result = new Uint8Array(G1_BYTES);
  result.set(x, 0);
  result.set(y, 32);
  return result;
}

function serializeG2Point(point) {
  // snarkjs format: [[x.c0, x.c1], [y.c0, y.c1], [z]]
  // EIP-196/Solana format: [x.c1, x.c0, y.c1, y.c0] each 32 bytes BE
  const xc0 = bigintToBytesBE(BigInt(point[0][0]));
  const xc1 = bigintToBytesBE(BigInt(point[0][1]));
  const yc0 = bigintToBytesBE(BigInt(point[1][0]));
  const yc1 = bigintToBytesBE(BigInt(point[1][1]));
  
  const result = new Uint8Array(G2_BYTES);
  result.set(xc1, 0);   // x.c1
  result.set(xc0, 32);  // x.c0
  result.set(yc1, 64);  // y.c1
  result.set(yc0, 96);  // y.c0
  return result;
}

function serializeVerifierKey(vkey) {
  console.log(`Serializing verifier key with ${vkey.IC.length} IC points`);
  
  const alpha = serializeG1Point(vkey.vk_alpha_1);
  const beta = serializeG2Point(vkey.vk_beta_2);
  const gamma = serializeG2Point(vkey.vk_gamma_2);
  const delta = serializeG2Point(vkey.vk_delta_2);
  
  // Serialize IC points
  const icPoints = vkey.IC.map(point => serializeG1Point(point));
  const icCount = new Uint8Array(4);
  new DataView(icCount.buffer).setUint32(0, vkey.IC.length, true); // little-endian
  
  // Pack everything: alpha(64) + beta(128) + gamma(128) + delta(128) + ic_count(4) + ic_points(64*n)
  const totalSize = G1_BYTES + G2_BYTES + G2_BYTES + G2_BYTES + 4 + (G1_BYTES * vkey.IC.length);
  const packed = new Uint8Array(totalSize);
  let offset = 0;
  
  packed.set(alpha, offset);
  offset += G1_BYTES;
  
  packed.set(beta, offset);
  offset += G2_BYTES;
  
  packed.set(gamma, offset);
  offset += G2_BYTES;
  
  packed.set(delta, offset);
  offset += G2_BYTES;
  
  packed.set(icCount, offset);
  offset += 4;
  
  for (const icPoint of icPoints) {
    packed.set(icPoint, offset);
    offset += G1_BYTES;
  }
  
  console.log(`Serialized verifier key: ${packed.length} bytes`);
  return Buffer.from(packed);
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  
  // Load admin keypair
  const keypairPath = '/Users/banel/config/solana/id.json';
  const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  const admin = Keypair.fromSecretKey(new Uint8Array(keypairData));
  console.log('Admin:', admin.publicKey.toBase58());
  
  // Load IDL
  const idlPath = path.join(__dirname, '..', 'target', 'idl', 'noctura_shield.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  
  // Create provider
  const wallet = new anchor.Wallet(admin);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
  const program = new anchor.Program(idl, PROGRAM_ID, provider);
  
  // Load consolidate verification key
  const vkeyPath = path.join(__dirname, '..', 'zk', 'keys', 'consolidate.vkey.json');
  const vkey = JSON.parse(fs.readFileSync(vkeyPath, 'utf-8'));
  const vkeyBytes = serializeVerifierKey(vkey);
  
  // PDAs
  const [globalState] = PublicKey.findProgramAddressSync(
    [Buffer.from('global-state')],
    PROGRAM_ID
  );
  const [consolidateVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('consolidate-verifier')],
    PROGRAM_ID
  );
  
  console.log('Global State:', globalState.toBase58());
  console.log('Consolidate Verifier:', consolidateVerifier.toBase58());
  
  // Check if we need chunked upload (>900 bytes)
  if (vkeyBytes.length > 900) {
    console.log('Using chunked upload...');
    
    // Initialize
    try {
      const initTx = await program.methods
        .initConsolidateVerifierChunked()
        .accounts({
          admin: admin.publicKey,
          globalState,
          consolidateVerifier,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log('Init tx:', initTx);
    } catch (e) {
      console.log('Init may already exist:', e.message?.substring(0, 100));
    }
    
    // Upload in chunks
    const CHUNK_SIZE = 800;
    for (let i = 0; i < vkeyBytes.length; i += CHUNK_SIZE) {
      const chunk = vkeyBytes.slice(i, Math.min(i + CHUNK_SIZE, vkeyBytes.length));
      console.log(`Uploading chunk ${Math.floor(i/CHUNK_SIZE) + 1}/${Math.ceil(vkeyBytes.length/CHUNK_SIZE)}: ${chunk.length} bytes`);
      
      const chunkTx = await program.methods
        .appendConsolidateVerifierChunk(Buffer.from(chunk))
        .accounts({
          admin: admin.publicKey,
          globalState,
          consolidateVerifier,
        })
        .rpc();
      console.log('Chunk tx:', chunkTx);
    }
    
    // Finalize
    const finalizeTx = await program.methods
      .finalizeConsolidateVerifier()
      .accounts({
        admin: admin.publicKey,
        globalState,
        consolidateVerifier,
      })
      .rpc();
    console.log('Finalize tx:', finalizeTx);
    
  } else {
    // Single transaction - won't happen for consolidate (it's large)
    throw new Error('Consolidate verifier key should require chunked upload');
  }
  
  console.log('✅ Consolidate verifier set successfully!');
}

main().catch(console.error);
