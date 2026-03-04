# Shielded Swap + Consolidation Workflow - End-to-End Test Guide

## Overview
This documents the new seamless consolidation workflow for shielded swaps. The system now handles multi-note swaps through a clear two-step process with UI guidance.

## Test Scenario

### Setup: Create multiple small notes
1. **Start with shielded balance** with 5 notes × 20 NOC (100 NOC total)
   - Or any configuration with multiple notes
   - Notes should all be the same token type (SOL or NOC)

### Step 1: Initiate Swap (Without Consolidation)

1. **Open Shielded Swap Modal**
   - Click "Private Swap" button in Dashboard
   - Mode should show "🔒 Private swap from shielded balance"

2. **Select Swap Parameters**
   - From: NOC
   - To: SOL
   - Amount: 10 NOC (less than what any single note contains, but total available is 100)
   - Set slippage: 0.5%

3. **Expected Error**
   - Swap button will show error when you try to click it:
   ```
   To swap 10.00 NOC:

   You have 100.00 NOC across 5 separate notes.

   NEXT STEP:
   1. Go to Shielded Actions → Consolidate Notes
   2. Select your notes and consolidate them
   3. Return here and try the swap again

   Consolidation merges your multiple notes into one while keeping them fully shielded. No tokens ever leave the private layer.
   ```

### Step 2: Consolidation Workflow

4. **Open Consolidation Modal**
   - In the error message UI, you now see a purple box with:
     - "Notes need consolidation" header
     - Description: "Your balance is spread across multiple notes..."
     - Button: "✓ Consolidate Now"
   - Click "Consolidate Now" button

5. **ConsolidateModal Opens**
   - Shows header: "Consolidate Notes"
   - Shows summary:
     - Available notes: 5
     - Total NOC: 100.00
   - Shows note list with checkboxes (max 64px width for easy interaction):
     ```
     ☑ 20.00 NOC  (nullifier: 0x1234...)
     ☑ 20.00 NOC  (nullifier: 0x5678...)
     ☑ 20.00 NOC  (nullifier: 0x9abc...)
     ☑ 20.00 NOC  (nullifier: 0xdef0...)
     ☑ 20.00 NOC  (nullifier: 0x1111...)
     ```

6. **Select Notes for Consolidation**
   - Button options at top: "Select All" / "Deselect All"
   - User can:
     - Click "Select All" to select all 5 notes
     - Or manually click checkboxes to select specific notes
     - Minimum: 2 notes required to consolidate

7. **View Consolidation Summary**
   - After selecting all 5 notes:
     ```
     Available notes: 5
     Total NOC: 100.00
     ---
     Selected to merge: 5 notes (100.00 NOC)
     ```
   - Button updates: "Consolidate 5 Notes → 1 Note"

8. **Execute Consolidation**
   - Click "Consolidate 5 Notes → 1 Note" button
   - Watch progress messages:
     ```
     Consolidating batch 1/1… (proof generation ~30-60s)
     ↓
     Generating proof 1/1…
     ↓
     Submitting consolidation 1/1…
     ```

9. **Consolidation Completes**
   - Success modal appears with:
     - Large checkmark icon (purple background)
     - "Consolidation Complete!" title
     - Message: "Your 5 notes have been merged into 1 consolidated note(s)."
     - Confirmation: "All 100.00 NOC preserved in your shielded vault."
     - Subtext: "Your notes are ready. You can now return to swap."
   - Button: "Done"

10. **Return to Swap**
    - Click "Done" button
    - ConsolidateModal closes
    - You're back at the SwapModal
    - The error message is gone!

### Step 3: Retry Swap (Now with Consolidated Note)

11. **Swap Now Works**
    - Amount field still has: 10 NOC
    - Quote is fetched and displays
    - Swap button is now ENABLED (no longer disabled by consolidation error)
    - Button text: "Swap 10.00 NOC → [output amount] SOL (Private)"

12. **Execute Swap**
    - Click "Swap 10 NOC → X SOL (Private)" button
    - Watch progress:
      ```
      🔒 TRUE PRIVATE swap mode - tokens stay shielded
      ↓
      Calculating swap output...
      ↓
      Building merkle proof...
      ↓
      Generating ZK swap proof...
      ↓
      Executing private swap on-chain...
      ```

13. **Swap Success**
    - Success modal appears with:
      - Large checkmark icon
      - "Swap Successful!" title
      - Swapped: 10 NOC
      - Received: X SOL (in purple)
      - "Your balances have been updated"
    - Click "Done"
    - Dashboard updates with new balances

## Key Features to Verify

### ConsolidateModal Features
- ✅ Displays correct number of available notes
- ✅ Shows total balance for token type
- ✅ Select/deselect all functionality works
- ✅ Individual checkbox selection works
- ✅ Minimum 2 notes validation
- ✅ Progress messages during consolidation
- ✅ Success modal with correct totals
- ✅ Modal closes after consolidation
- ✅ Transaction is recorded in history

### SwapModal Features
- ✅ Detects consolidation error from swap failure
- ✅ Shows purple consolidation UI box
- ✅ "Consolidate Now" button triggers modal
- ✅ Swap button is disabled when consolidation needed
- ✅ Error clears after consolidation
- ✅ Swap succeeds on second attempt

### App.tsx Integration
- ✅ `handleConsolidate` function works correctly
- ✅ `handleSwapNeedsConsolidation` triggers on error
- ✅ State properly managed (showConsolidateModal, consolidateFor, etc.)
- ✅ Consolidation marks old notes as spent
- ✅ New consolidated note is added to shieldedNotes
- ✅ Transaction history records consolidation
- ✅ Token mint fields are correct in consolidated notes

## Test Cases

### Test Case 1: Multi-note swap (user scenario from issue)
- **Setup**: 5 × 20 NOC notes
- **Action**: Try to swap 10 NOC
- **Expected**: 
  1. Error shown with consolidation suggestion
  2. Consolidation workflow opens
  3. All notes consolidated
  4. Swap succeeds on second attempt
  5. Final balance: 90 NOC + X SOL

### Test Case 2: Consolidate subset of notes
- **Setup**: 5 × 20 NOC notes
- **Action**: Consolidate only 3 notes
- **Expected**:
  1. Can select just 3 notes
  2. Result is 1 consolidated note (60 NOC) + 2 original notes (40 NOC)
  3. Can swap from either note by selecting it
  4. Total balance unchanged

### Test Case 3: Denominational precision
- **Setup**: Mix of different note amounts (20, 30, 10, 50 NOC)
- **Action**: Consolidate all
- **Expected**:
  1. All amounts sum correctly in UI
  2. Result is 1 note with exact total amount
  3. No loss of funds

### Test Case 4: SOL consolidation
- **Setup**: Multiple shielded SOL notes
- **Action**: Consolidate and swap SOL → NOC
- **Expected**: Same workflow works for SOL with correct token type

## Debugging Checklist

If something goes wrong:

1. **Check console for errors**
   ```
   [Consolidate] Starting consolidation of X notes
   [Consolidate] Step 1: merging X notes
   [Consolidate] Proof X generated
   [Consolidate] Submitted: [signature]
   ```

2. **Verify shielded notes list**
   - Use devtools: `__noctura_debug.getShieldedNotes()`
   - Check that old notes are marked as spent
   - Verify new consolidated note has correct amount

3. **Check token mint fields**
   - Old: `note.tokenMintField` should match `EXPECTED_NOC_TOKEN_MINT_FIELD`
   - New consolidated note should have same tokenMintField value

4. **Transaction history**
   - Consolidation should appear as type: 'consolidate'
   - Status: 'success'
   - Amount: "N notes → 1 note"

## Performance Notes

- **Consolidation duration**: ~1-2 minutes per consolidation step
  - Proof generation: ~30-60s
  - Relay submission: ~30s
- **UI responsiveness**: Modal shows progress messages every step
- **Multiple steps**: If consolidating 9+ notes, will create multiple consolidation steps batched in groups of ~8

## Known Limitations

1. **Consolidation circuit constraint**
   - Consolidation PRESERVES total value (cannot do partial consolidation)
   - This is why the two-step workflow is necessary
   - Swap circuit requires exact-match or single-note input

2. **Maximum notes per consolidation**
   - Circuit supports up to 8 input notes per consolidation step
   - System automatically batches larger consolidations

3. **Manual consolidation required**
   - User must explicitly consolidate before swap if not exact-match
   - This is by design for circuit safety and transparency

## User Experience Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ User Initiates Shielded Swap with 10 NOC                    │
│ (Has 5 × 20 NOC notes, wants to swap 10)                    │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│ SwapModal detects no exact-match note                       │
│ Shows error with "Consolidate Now" button (purple UI)       │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│ User clicks "Consolidate Now"                               │
│ ConsolidateModal opens showing 5 notes                       │
└─────────────────────────────────────────────────────────────┘
              ↓
         (User selects all 5 notes)
              ↓
┌─────────────────────────────────────────────────────────────┐
│ User clicks "Consolidate 5 Notes → 1 Note"                  │
│ Progress: Proof generation → Submission → Success           │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│ Success modal appears                                       │
│ "All 100 NOC preserved in your shielded vault"             │
│ User clicks "Done"                                          │
└─────────────────────────────────────────────────────────────┘
              ↓
┌─────────────────────────────────────────────────────────────┐
│ Back to SwapModal                                            │
│ Now has 1 consolidated 100 NOC note (exact-match!)         │
│ Swap button is ENABLED                                      │
└─────────────────────────────────────────────────────────────┘
              ↓
         (User retries swap)
              ↓
┌─────────────────────────────────────────────────────────────┐
│ Swap executes successfully!                                  │
│ 10 NOC → X SOL, privately                                    │
│ Success modal confirms transaction                          │
└─────────────────────────────────────────────────────────────┘
```

## Next Steps After Testing

1. **Document the workflow** in user guide
2. **Add tooltips** to help text in UI if needed
3. **Monitor consolidation times** - may need to optimize proof generation
4. **Collect feedback** on the two-step workflow from real users
5. Consider: "One-click Consolidate & Swap" button for future iteration
