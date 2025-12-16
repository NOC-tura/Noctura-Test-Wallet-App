// Quick test to identify the 43 NOC mystery
// Run this in browser console

(async () => {
  console.log('=== SHIELDED BALANCE DIAGNOSIS ===\n');
  
  // Get all data
  const notesAnalysis = __noctura_debug.getShieldedNotes();
  const balanceAnalysis = __noctura_debug.getBalance();
  
  console.log('📊 NOTES OVERVIEW:');
  console.log(`  Total notes: ${notesAnalysis.totalNotes}`);
  console.log(`  Owned by wallet: ${notesAnalysis.summary.ownedByWallet}`);
  console.log(`  Unspent: ${notesAnalysis.summary.unspentCount}`);
  console.log(`  Spent: ${notesAnalysis.summary.spentCount}\n`);
  
  console.log('💰 BALANCE MISMATCH:');
  console.log(`  Raw UI display: ${balanceAnalysis.raw.shieldedNoc} NOC`);
  console.log(`  Calculated from notes: ${balanceAnalysis.displayable.noc} NOC`);
  console.log(`  Difference: ${(parseFloat(balanceAnalysis.raw.shieldedNoc) - parseFloat(balanceAnalysis.displayable.noc)).toFixed(6)} NOC\n`);
  
  console.log('🔍 BREAKDOWN BY TOKEN:');
  Object.entries(balanceAnalysis.calculated).forEach(([type, atoms]) => {
    const displayValue = type === 'nocAtoms' 
      ? (BigInt(atoms) / BigInt(1_000_000)).toString() 
      : (BigInt(atoms) / BigInt(1_000_000_000)).toString();
    console.log(`  ${type}: ${atoms} atoms = ${displayValue} units`);
  });
  
  console.log('\n🔎 INDIVIDUAL NOTES:');
  notesAnalysis.notes.forEach((n, i) => {
    console.log(`  Note ${i + 1}:`);
    console.log(`    Type: ${n.tokenType || 'UNKNOWN'}`);
    console.log(`    Amount: ${n.displayAmountNoc} NOC (${n.amount} atoms)`);
    console.log(`    Spent: ${n.spent}`);
    console.log(`    Owned: ${n.isOwned}`);
    console.log(`    Created: ${n.createdAt}`);
  });
  
  // Try to find where 43 comes from
  console.log('\n🎯 INVESTIGATING 43 NOC:');
  const noteAmounts = notesAnalysis.notes.map(n => BigInt(n.amount));
  const unspentAmounts = notesAnalysis.notes
    .filter(n => !n.spent && n.isOwned)
    .map(n => BigInt(n.amount));
  
  console.log(`  Sum of all note amounts: ${noteAmounts.reduce((a, b) => a + b, 0n)} atoms`);
  console.log(`  Sum of unspent owned notes: ${unspentAmounts.reduce((a, b) => a + b, 0n)} atoms`);
  
  // Check if 43 NOC = 43,000,000 atoms
  const fortyThreeNoc = 43_000_000n;
  console.log(`  43 NOC in atoms: ${fortyThreeNoc}`);
  console.log(`  Does any note equal 43 NOC? ${notesAnalysis.notes.some(n => BigInt(n.amount) === fortyThreeNoc)}`);
  
  // Check sums
  const allSum = noteAmounts.reduce((a, b) => a + b, 0n);
  const unspentSum = unspentAmounts.reduce((a, b) => a + b, 0n);
  console.log(`  Total: ${(Number(allSum) / 1_000_000).toFixed(2)} NOC`);
  console.log(`  Unspent: ${(Number(unspentSum) / 1_000_000).toFixed(2)} NOC`);
  
  console.log('\n💾 CHECKING LOCALSTORAGE:');
  const stored = localStorage.getItem('shielded-notes-storage');
  if (stored) {
    const parsed = JSON.parse(stored);
    console.log(`  Raw storage keys: ${Object.keys(parsed).join(', ')}`);
    if (parsed.state && parsed.state.notes) {
      console.log(`  Notes in storage: ${parsed.state.notes.length}`);
    }
  }
  
  console.log('\n✅ DIAGNOSIS COMPLETE');
  console.log('If calculated ≠ UI display, there may be stale notes in localStorage');
  console.log('Run: __noctura_debug.clearAllNotes() to reset, then re-deposit');
})();
