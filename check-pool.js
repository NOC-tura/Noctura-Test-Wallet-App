const { Connection, PublicKey } = require('@solana/web3.js');
const BN = require('bn.js');

async function checkPool() {
  const conn = new Connection('https://api.devnet.solana.com', 'confirmed');
  const PROGRAM_ID = new PublicKey('shd1jxmbymMTTY1nfLqqc2NFf7WaCREwqmqFFBxFNnN');
  
  const [shieldedPool] = PublicKey.findProgramAddressSync(
    [Buffer.from('shielded-pool')],
    PROGRAM_ID
  );
  
  console.log('Shielded Pool PDA:', shieldedPool.toBase58());
  
  const accountInfo = await conn.getAccountInfo(shieldedPool);
  if (!accountInfo) {
    console.log('Pool NOT initialized!');
    return;
  }
  
  const data = accountInfo.data.slice(8);
  const solReserve = new BN(data.slice(32, 40), 'le');
  const nocReserve = new BN(data.slice(40, 48), 'le');
  const lpTotalSupply = new BN(data.slice(48, 56), 'le');
  const swapFeeBps = data.readUInt16LE(56);
  const enabled = data[59] === 1;
  
  console.log('SOL Reserve:', solReserve.toString(), '=', Number(solReserve.toString()) / 1e9, 'SOL');
  console.log('NOC Reserve:', nocReserve.toString(), '=', Number(nocReserve.toString()) / 1e6, 'NOC');
  console.log('NOC/SOL Ratio:', Number(nocReserve.toString()) / 1e6 / (Number(solReserve.toString()) / 1e9));
  console.log('LP Supply:', lpTotalSupply.toString());
  console.log('Swap Fee BPS:', swapFeeBps);
  console.log('Enabled:', enabled);
}

checkPool().catch(console.error);
