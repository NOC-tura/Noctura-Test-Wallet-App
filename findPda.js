const { PublicKey } = require('@solana/web3.js');
const PROGRAM_ID = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');
const NOC_MINT = new PublicKey('FAPAn9p8guXxrCqqNXsxX8qLSzLFqmKojeejobsh3sPg');
const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

const seeds = [
  ['vault-authority', NOC_MINT],
  ['vault-token', NOC_MINT],
  ['vault_authority', NOC_MINT],
  ['vault-authority', SOL_MINT],
];

seeds.forEach(([seed, mint]) => {
  const [pda] = PublicKey.findProgramAddressSync([Buffer.from(seed), mint.toBuffer()], PROGRAM_ID);
  console.log(seed, mint.toBase58().substring(0,8), '->', pda.toBase58());
});

console.log('\\nTarget owner:', 'GMg9c3P9XXUaT4QKbTeD6vDaRhR7zQzguLy8zkbQLh1u');
console.log('Target vault account:', 'Dqv33MqKMLPfxWu6MMSR2ycSNVAsSVMuLiaYv88aTr21');
