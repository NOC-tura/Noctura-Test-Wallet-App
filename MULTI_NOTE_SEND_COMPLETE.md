# Multi-Note Staged Send Implementation

## Overview
Implemented full multi-note staged send capability for SOL withdrawals from shielded vault, allowing users to send any amount up to their total shielded balance across multiple notes.

## Features Implemented

### 1. Note Planning (`app/src/lib/notePlanner.ts`)
- **Greedy largest-first selection**: Sorts notes by size descending
- **Full withdrawals first**: Uses complete notes when possible
- **Final partial**: Splits the last note if needed to hit exact amount
- Returns structured plan with step count, fee estimate, and partial flag

### 2. Staged Execution (`App.tsx::executeStagedSolSend`)
- **Single confirmation**: User confirms once, all steps execute automatically
- **NOC fee pre-check**: Validates transparent NOC balance covers all privacy fees (0.25 NOC per withdrawal)
- **Step-by-step execution**:
  - Full withdrawals: prove → submit → mark spent
  - Partial (if needed): split note (relayed) → track change → prove recipient portion → withdraw
- **Live Merkle proofs**: Rebuilds proof for each step with current note set
- **Clear progress**: Updates status with "Step X/Y: [action]" messages

### 3. Retry & Backoff
- **Exponential backoff**: Base 1-2s delay, doubles each retry
- **Per-operation retries**:
  - Proof generation: 3 attempts (proofs can timeout)
  - Network submission: 2 attempts (handle transient RPC issues)
- **Context-aware logging**: Each retry logs attempt number and context

### 4. Confirmation Modal
- **Staged send modal** (`App.tsx::stagedSendModal`):
  - Shows recipient, total amount, step count
  - Breaks down full vs partial withdrawals
  - Displays estimated privacy fees and network fees
  - Matches existing modal styling (cyber theme)
- **Replaces window.confirm** with proper UI component

### 5. Integration
- **Auto-triggered**: When SOL send amount > largest note but ≤ total, and transparent payout enabled
- **Graceful fallback**: If notes insufficient or NOC low, provides clear error
- **Balance refresh**: Auto-refreshes after completion

## Usage Flow

1. User tries to send 1.2 SOL from shielded vault (transparent payout)
2. Largest note is 0.6 SOL, but total across 3 notes is 1.5 SOL
3. App detects multi-note scenario and shows staged send modal:
   - "Send 1.2 SOL using 3 notes"
   - "2 full withdrawals + 1 partial"
   - "Privacy fees: ~0.75 NOC"
4. User confirms
5. App executes:
   - Step 1/3: Prove + withdraw 0.6 SOL (full)
   - Step 2/3: Prove + withdraw 0.5 SOL (full)
   - Step 3/3: Split 0.4 SOL note (0.1 SOL + fee recipient, 0.3 SOL change) → prove + withdraw 0.1 SOL
6. Status: "✅ Staged send complete! 3 note(s) used, 1.2000 SOL sent."

## Technical Details

### Fee Accounting
- **Privacy fee**: 0.25 NOC per withdrawal step (charged from transparent NOC balance)
- **Network fee**: ~0.000005 SOL per step (paid from SOL balance)
- **Pre-validation**: Checks NOC balance before starting to avoid mid-flow failures

### Proof Requirements
- Each withdrawal requires a separate zero-knowledge proof (30-60s each)
- Partial step requires 2 proofs: split (transfer circuit) + withdraw
- Proofs are generated sequentially to maintain valid Merkle roots

### State Management
- Notes marked spent immediately after on-chain confirmation
- Change notes from splits added to local state for subsequent steps
- Available notes list updated between steps for accurate Merkle proofs

## Testing

### Smoke Test
Run: `node app/scripts/test-staged-send.mjs`

Validates:
- Single full withdrawal
- Multiple full withdrawals  
- Full + partial combination
- Fee estimation accuracy
- Insufficient balance handling

### Manual E2E Test
1. Ensure multiple SOL notes in shielded vault
2. Ensure NOC in transparent wallet (≥ 0.25 NOC per note to spend)
3. Attempt send > largest note, < total balance
4. Confirm staged send modal appears
5. Verify each step completes with status updates
6. Check final balance reflects sent amount

## Known Limitations

1. **SOL only**: Staged send currently limited to SOL; NOC still uses single-note path
2. **Prover latency**: Each proof takes 30-60s; 3-note send = ~3-5 minutes total
3. **No parallelization**: Steps execute sequentially (required for Merkle proof consistency)
4. **No mid-flow recovery**: If a step fails after retry, user must restart (change notes preserved)

## Future Enhancements

- Extend to NOC token
- Parallel proof generation (requires multi-input circuit)
- Mid-flow resume from last successful step
- Batch multiple steps into single transaction (when possible)
- Progress bar with ETA per step

## Files Modified

1. `app/src/lib/notePlanner.ts` - NEW: Planning logic
2. `app/src/lib/shieldProgram.ts` - Combined fee+withdraw logic
3. `app/src/App.tsx` - Staged executor, retry helper, modal UI
4. `app/scripts/test-staged-send.mjs` - NEW: Smoke test

## Build Status
✅ Vite production build passes
✅ Planning logic smoke test passes
✅ Ready for devnet testing
