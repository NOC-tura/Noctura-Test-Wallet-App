const { Connection, PublicKey } = require('@solana/web3.js');

async function main() {
  const conn = new Connection('https://api.devnet.solana.com');
  const mint = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
  const authority = new PublicKey('55qTjy2AAFxohJtzKbKbZHjQBNwAven2vMfFVUfDZnax');
  
  try {
    const info = await conn.getAccountInfo(mint);
    if (!info) {
      console.log('Mint not found on devnet');
      return;
    }
    console.log('Mint found, data length:', info.data.length);
    
    const supply = await conn.getTokenSupply(mint);
    console.log('Supply:', Number(supply.value.amount) / 1e6);
    console.log('Decimals:', supply.value.decimals);
    
    // Check authority balance of this token
    const { getAssociatedTokenAddress } = require('@solana/spl-token');
    const authorityAta = await getAssociatedTokenAddress(mint, authority);
    console.log('Authority ATA:', authorityAta.toBase58());
    
    try {
      const ataInfo = await conn.getTokenAccountBalance(authorityAta);
      console.log('Authority balance:', Number(ataInfo.value.amount) / 1e6);
    } catch (e) {
      console.log('Authority has no token account for this mint');
    }
  } catch (e) {
    console.log('Error:', e.message);
  }
}

main();
