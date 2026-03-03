const { Connection, PublicKey } = require('@solana/web3.js');

async function check() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
  
  const [swapVerifier] = PublicKey.findProgramAddressSync(
    [Buffer.from('swap-verifier')],
    PROGRAM_ID
  );
  
  console.log('Swap Verifier PDA:', swapVerifier.toBase58());
  
  const accountInfo = await conn.getAccountInfo(swapVerifier);
  if (accountInfo === null) {
    console.log('Swap Verifier: NOT SET');
    console.log('TRUE private swaps will fall back to relayer mode');
  } else {
    console.log('Swap Verifier: SET (' + accountInfo.data.length + ' bytes)');
    console.log('TRUE private swaps are ENABLED');
  }
}

check().catch(console.error);
