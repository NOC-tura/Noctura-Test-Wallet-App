/**
 * Script to set shield fees to 0
 * 
 * NOTE: This should be called from the browser console instead, as it requires
 * the wallet to be loaded and connected to the app.
 * 
 * Usage (in browser console, F12):
 *   window.debugApi.setShieldFees()
 *     .then(r => console.log("✅ Result:", r))
 *     .catch(e => console.error("❌ Error:", e))
 * 
 * Only the program admin (deployer) can set fees.
 */

console.log('🔧 Shield Fees Configuration');
console.log('');
console.log('To set shield fees to 0, use the browser console:');
console.log('');
console.log('  window.debugApi.setShieldFees()');
console.log('    .then(r => console.log("✅ Result:", r))');
console.log('    .catch(e => console.error("❌ Error:", e))');
console.log('');
console.log('Requirements:');
console.log('  1. Open the Noctura app in browser');
console.log('  2. Press F12 to open developer console');
console.log('  3. You must be the program admin (deployer)');
console.log('');
console.log('This sets both shield_fee_bps and priority_fee_bps to 0.');
console.log('Leaves only the fixed 0.25 NOC privacy fee for shielded transactions.');

