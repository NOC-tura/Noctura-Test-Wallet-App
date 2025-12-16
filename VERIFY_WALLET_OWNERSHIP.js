// Run this in browser console to verify what's REALLY in your wallet

console.log('=== WALLET OWNERSHIP VERIFICATION ===\n')

// Get all data
const analysis = __noctura_debug.getShieldedNotes()
const balance = __noctura_debug.getBalance()

const myAddress = analysis.walletAddress
const allNotes = analysis.notes

console.log('📍 YOUR WALLET ADDRESS:', myAddress)
console.log('📊 TOTAL NOTES IN STORAGE:', allNotes.length)
console.log('')

// Split owned vs not owned
const ownedNotes = allNotes.filter(n => n.isOwned)
const notOwnedNotes = allNotes.filter(n => !n.isOwned)

console.log('✅ NOTES YOU OWN:', ownedNotes.length)
console.log('❌ NOTES YOU DON\'T OWN:', notOwnedNotes.length)
console.log('')

if (notOwnedNotes.length > 0) {
  console.log('⚠️ WARNING: Found notes not owned by you!')
  console.log('These notes belong to OTHER wallets:')
  console.table(notOwnedNotes.map(n => ({
    owner: n.owner,
    amount: n.displayAmountNoc + ' NOC',
    type: n.tokenType || 'undefined',
    spent: n.spent,
  })))
  console.log('')
}

// Analyze YOUR notes
console.log('🔍 YOUR NOTES BREAKDOWN:')
const ownedBreakdown = {
  total: ownedNotes.length,
  unspent: ownedNotes.filter(n => !n.spent).length,
  spent: ownedNotes.filter(n => n.spent).length,
}
console.log(ownedBreakdown)
console.log('')

// Show your unspent notes
const yourUnspent = ownedNotes.filter(n => !n.spent)
console.log('💰 YOUR UNSPENT NOTES (count=' + yourUnspent.length + '):')
console.table(yourUnspent.map((n, i) => ({
  index: i,
  amount: n.displayAmountNoc + ' ' + (n.tokenType || 'UNKNOWN'),
  type: n.tokenType || 'undefined',
  spent: n.spent,
  createdAt: n.createdAt,
  nullifier: n.nullifier.slice(0, 16) + '...',
})))
console.log('')

// Analyze token types
console.log('🏷️ TOKEN TYPE ANALYSIS:')
const byType = {}
ownedNotes.forEach(n => {
  const type = n.tokenType || 'UNDEFINED'
  if (!byType[type]) byType[type] = { count: 0, total: 0n, unspent: 0 }
  byType[type].count++
  byType[type].total += BigInt(n.amount)
  if (!n.spent) byType[type].unspent++
})

Object.entries(byType).forEach(([type, data]) => {
  const displayAmount = type === 'SOL' 
    ? (Number(data.total) / 1_000_000_000).toFixed(9)
    : (Number(data.total) / 1_000_000).toFixed(2)
  console.log(`${type}: ${data.count} notes (${data.unspent} unspent) = ${displayAmount}`)
})
console.log('')

// Check for test data
console.log('🔎 CHECKING FOR TEST/OLD DATA:')
const oldNotes = ownedNotes.filter(n => {
  const date = new Date(n.createdAt)
  return date < new Date('2025-12-02')
})
console.log('Notes from before Dec 2:', oldNotes.length)
if (oldNotes.length > 0) {
  console.log('These are likely old test data:')
  console.table(oldNotes.map(n => ({
    amount: n.displayAmountNoc,
    type: n.tokenType || 'undefined',
    created: new Date(n.createdAt).toISOString().split('T')[0],
    spent: n.spent,
  })))
  console.log('')
}

// The critical question
console.log('❓ CRITICAL: THE 43 NOC NOTE')
const note43 = ownedNotes.find(n => n.displayAmountNoc === '43')
if (note43) {
  console.log('FOUND:')
  console.log('  Amount:', note43.displayAmountNoc, 'NOC')
  console.log('  Type:', note43.tokenType)
  console.log('  Spent:', note43.spent)
  console.log('  Created:', new Date(note43.createdAt).toISOString())
  console.log('  Owner:', note43.owner)
  console.log('  Is yours?', note43.isOwned)
  console.log('')
  
  if (note43.isOwned && !note43.spent && note43.tokenType === 'NOC') {
    console.log('⚠️ THIS NOTE IS YOURS AND UNSPENT')
    console.log('But you said you never created shielded NOC deposits!')
    console.log('Questions:')
    console.log('  1. Did you create a shielded NOC deposit on Dec 3?')
    console.log('  2. Could this be from a test/demo run?')
    console.log('  3. Could this be corrupted data?')
  }
} else {
  console.log('Not found in your notes')
}
console.log('')

// Summary
console.log('📋 SUMMARY:')
console.log('Your wallet address:', myAddress)
console.log('Notes you own:', ownedNotes.length)
console.log('Notes unspent:', ownedNotes.filter(n => !n.spent).length)
console.log('Display balance NOC:', balance.raw.shieldedNoc)
console.log('Display balance SOL:', balance.raw.shieldedSol)
console.log('')
console.log('✅ Analysis complete. Check answers to critical questions above.')
