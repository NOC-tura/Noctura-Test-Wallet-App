// Quick script to check program admin
const { Connection, PublicKey } = require('@solana/web3.js');
const { Program, AnchorProvider } = require('@coral-xyz/anchor');
const idl = require('./app/src/lib/idl/noctura_shield.json');

const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
const programId = new PublicKey('3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz');

const provider = new AnchorProvider(connection, null, {});
const program = new Program(idl, programId, provider);

const [globalState] = PublicKey.findProgramAddressSync(
  [Buffer.from('global-state')],
  programId
);

program.account.globalState.fetch(globalState).then(state => {
  console.log('Admin:', state.admin.toString());
  console.log('Fee Collector:', state.feeCollector.toString());
  console.log('Shield Fee (bps):', state.shieldFeeBps);
  console.log('Priority Fee (bps):', state.priorityFeeBps);
}).catch(err => {
  console.error('Error:', err.message);
});
