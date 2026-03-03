const { Connection, PublicKey } = require('@solana/web3.js');

const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const GLOBAL_STATE_SEED = Buffer.from('global-state');

async function main() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const [globalState] = PublicKey.findProgramAddressSync([GLOBAL_STATE_SEED], PROGRAM_ID);
  console.log('Global State:', globalState.toBase58());
  
  const info = await connection.getAccountInfo(globalState);
  if (!info) {
    console.log('Global state not found');
    return;
  }
  
  // Parse global state - skip 8-byte discriminator
  const data = info.data.slice(8);
  
  // GlobalState structure (from lib.rs):
  // admin: Pubkey (32 bytes)
  // fee_collector: Pubkey (32 bytes)  
  // shield_fee_bps: u16 (2 bytes)
  // priority_fee_bps: u16 (2 bytes)
  
  const admin = new PublicKey(data.slice(0, 32)).toBase58();
  const feeCollector = new PublicKey(data.slice(32, 64)).toBase58();
  const shieldFeeBps = data.readUInt16LE(64);
  const priorityFeeBps = data.readUInt16LE(66);
  
  console.log('Admin:', admin);
  console.log('Fee Collector:', feeCollector);
  console.log('Shield Fee (bps):', shieldFeeBps, '(' + (shieldFeeBps / 100) + '%)');
  console.log('Priority Fee (bps):', priorityFeeBps, '(' + (priorityFeeBps / 100) + '%)');
}

main().catch(console.error);
