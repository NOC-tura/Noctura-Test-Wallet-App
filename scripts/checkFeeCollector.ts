import { Keypair, PublicKey } from '@solana/web3.js';
import { getProgramForKeypair, deriveShieldPdas } from '../app/src/lib/anchorClient';

/**
 * Check which address is configured as the fee collector for 0.25 NOC shielded fees
 */
async function checkFeeCollector() {
  try {
    // Use any keypair to fetch (readonly query)
    const dummyKeypair = Keypair.generate();
    const program = getProgramForKeypair(dummyKeypair);
    const pdas = deriveShieldPdas();

    console.log('🔍 Fetching shield program global state...');
    const globalState = await program.account.globalState.fetch(pdas.globalState);
    
    const feeCollector = (globalState as any).feeCollector;
    console.log('\n📋 Shield Program Fee Collector');
    console.log('================================');
    console.log('Fee Collector Address:', feeCollector);
    console.log('\nThis address receives 0.25 NOC from every shielded transaction:');
    console.log('  - Deposits');
    console.log('  - Transfers');
    console.log('  - Withdrawals');
    console.log('\n🔗 View on Solana Explorer:');
    console.log(`   https://explorer.solana.com/address/${feeCollector}?cluster=devnet`);
    
  } catch (err) {
    console.error('❌ Failed to fetch fee collector:', err);
    console.log('\nMake sure:');
    console.log('  1. You have internet connection');
    console.log('  2. Solana devnet is reachable');
    console.log('  3. The shield program is initialized');
  }
}

checkFeeCollector();
