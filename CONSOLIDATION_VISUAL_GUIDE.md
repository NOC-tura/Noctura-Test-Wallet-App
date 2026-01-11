# Automatic Note Consolidation - Visual Guide

## High-Level User Flow

```
┌─────────────────────────────────────────────────────────────┐
│  USER: Deposits 300 SOL (300 separate times)                │
│  RESULT: 300 individual notes in shielded vault              │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  USER: "Send 300 SOL to myself" / Withdraw All              │
└─────────────────────────────────────────────────────────────┘
                            ↓
                    ┌───────────────┐
                    │  APP DETECTS  │
                    │  >4 Notes     │
                    └───────────────┘
                            ↓
            ┌───────────────────────────────┐
            │  AUTO-CONSOLIDATION TRIGGERED │
            │  (No user action needed!)      │
            └───────────────────────────────┘
                            ↓
    ┌─────────────────────────────────────────────┐
    │   CONSOLIDATION PHASE (Automatic)           │
    │                                             │
    │   Batch 1: 8 notes → 1 note (30-60s)       │
    │   Batch 2: 8 notes → 1 note (30-60s)       │
    │   ...                                       │
    │   Batch N: M notes → 1 note (30-60s)       │
    │                                             │
    │   Total: ~38 batches × 45s = 28-35 min     │
    │   Result: 300 notes → 1 large note          │
    └─────────────────────────────────────────────┘
                            ↓
    ┌─────────────────────────────────────────────┐
    │   FINAL TRANSFER PHASE                      │
    │                                             │
    │   Input: 1 consolidated note (300 SOL)     │
    │   Generate: Withdraw proof (30-60s)         │
    │   Submit: Via relayer to blockchain         │
    │   Result: 300 SOL → Wallet                  │
    └─────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  RESULT:                                                    │
│  ✅ Received: 300 SOL                                       │
│  ✅ Fees: ~0.00005 SOL (network) + 0.25 NOC (privacy)      │
│  ✅ Time: ~30-37 minutes total                              │
│  ✅ Transactions: 1 visible on blockchain (final withdrawal)│
└─────────────────────────────────────────────────────────────┘
```

## Detailed Consolidation Process

```
┌──────────────────────────────────────────────────────────────┐
│  CONSOLIDATION BATCHING ALGORITHM                            │
└──────────────────────────────────────────────────────────────┘

Input: 300 separate notes
       [N1, N2, N3, ..., N300]

Step 1: Partition into batches of 8
────────────────────────────────────
  Batch 1: [N1-N8]      → Consolidate → C1 (8 SOL)
  Batch 2: [N9-N16]     → Consolidate → C2 (8 SOL)
  Batch 3: [N17-N24]    → Consolidate → C3 (8 SOL)
  ...
  Batch 38: [N297-N300] → Consolidate → C38 (4 SOL)

Output after Step 1: 38 consolidated notes

Step 2: If > 4 consolidated notes, consolidate again
────────────────────────────────────────────────────
  Batch 1: [C1-C8]      → Consolidate → CC1 (64 SOL)
  Batch 2: [C9-C16]     → Consolidate → CC2 (64 SOL)
  ...
  Batch 5: [C33-C38]    → Consolidate → CC5 (36 SOL)

Output after Step 2: 5 consolidated notes

Step 3: Final consolidation if needed
──────────────────────────────────────
  [CC1-CC5] → Consolidate → FINAL (300 SOL)

Output: 1 final consolidated note (300 SOL)
```

## Note State Transitions

```
DEPOSIT PHASE:
═════════════
  SOL in Wallet
        ↓
  [Deposit Transaction]
        ↓
  Shielded Note (state: unspent)
        ↓
  (Repeat 300 times)
        ↓
  300 Shielded Notes (all unspent)

CONSOLIDATION PHASE:
═══════════════════
  Batch 1:
    Notes 1-8 (state: unspent)
            ↓
    [Generate Consolidation Proof]
            ↓
    [Submit via Relayer]
            ↓
    Notes 1-8 (state: spent) ✗
    Consolidated Note (state: unspent) ✓
    
  Batch 2, 3, ... (repeat for each batch)
  
  Final Result: 1 Consolidated Note (unspent)

WITHDRAWAL PHASE:
════════════════
  Consolidated Note (state: unspent)
            ↓
    [Generate Withdrawal Proof]
            ↓
    [Submit via Relayer]
            ↓
    Consolidated Note (state: spent) ✗
    SOL in Wallet ✓
```

## Circuit Flow Diagram

```
┌─────────────────────────────────────────┐
│  CONSOLIDATION CIRCUIT                  │
│  (Up to 8 inputs → 1 output)            │
└─────────────────────────────────────────┘

Input Side:
───────────
  Note 1 (1 SOL)  ─┐
  Note 2 (1 SOL)  ─┤
  Note 3 (1 SOL)  ─┤  ┌──────────────────┐
  ...              ├─→│  Verify:         │
  Note 8 (1 SOL)  ─┤  │  - Merkle proofs │
                     │  - Nullifiers     │
                     │  - Sum amounts    │
                     └──────────────────┘
                            ↓
                      [ZK Proof]
                            ↓
                     ┌──────────────────┐
                     │  Output:         │
                     │  - New commitment│
                     │  - Fresh secrets │
                     │  - Sum = 8 SOL   │
                     └──────────────────┘
                            ↓
                     Consolidated Note
                     (8 SOL, unspent)
```

## Privacy Model

```
┌──────────────────────────────────────────┐
│  BEFORE CONSOLIDATION                    │
├──────────────────────────────────────────┤
│  User's Wallet (Known)                   │
│    ├─ Note 1: commitment C1, amount A1   │
│    ├─ Note 2: commitment C2, amount A2   │
│    └─ ... 298 more notes                 │
│                                          │
│  Blockchain:                             │
│    ├─ Merkle Tree: [C1, C2, ..., C300]  │
│    └─ Nullifier Set: {}                  │
└──────────────────────────────────────────┘

CONSOLIDATION TRANSACTION:
──────────────────────────
  Input:  C1, C2, ..., C8
  Output: CC (new commitment)
  Proof:  ZK proof (doesn't reveal inputs)

┌──────────────────────────────────────────┐
│  AFTER CONSOLIDATION                     │
├──────────────────────────────────────────┤
│  User's Wallet (Known)                   │
│    ├─ Note C1: commitment CC1, amount 8  │
│    ├─ Note C2: commitment CC2, amount 8  │
│    └─ ... other consolidated notes       │
│                                          │
│  Blockchain:                             │
│    ├─ Merkle Tree: [C1, ..., CC1, ...]  │
│    └─ Nullifier Set: [N1, ..., N8, ...]│
│                                          │
│  Privacy Property:                       │
│    ❌ Blockchain cannot link:            │
│       C1-C8 → CC1                        │
│    ✅ All transactions look similar      │
│    ✅ Cover traffic from other users     │
│    ✅ Fresh randomness on outputs        │
└──────────────────────────────────────────┘
```

## Timeline Visualization (300 SOL Consolidation)

```
Minutes:  0    5    10   15   20   25   30   35   40
          |____|____|____|____|____|____|____|____|
          
Deposits:  ✓(done)

Consolidation:
          |█████████████████████████████████|  (28-35 min)
          └─ Batch 1  (30-60s)
             └─ Batch 2  (30-60s)
                └─ ... (38 batches)
                   └─ Batch 38 (30-60s)

Final Transfer:
                                           |███| (1-2 min)
                                           └─ Withdrawal proof
                                              └─ Relayer submit

Total Time: ~30-37 minutes
```

## State Transition Matrix

```
┌─────────────┬──────────────┬──────────────┬─────────────┐
│   State     │  Deposit     │ Consolidate  │  Withdraw   │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Unspent     │  ← Start     │              │ ← Available │
│             │   Note ✓     │              │    for use  │
├─────────────┼──────────────┼──────────────┼─────────────┤
│ In Progress │              │  ← During    │  ← During   │
│             │              │    proof gen │    proof gen│
├─────────────┼──────────────┼──────────────┼─────────────┤
│ Spent       │              │  ← After     │  ← After    │
│             │              │    consolidate  withdraw   │
│             │              │  Cannot reuse│  Cannot     │
│             │              │              │  reuse      │
└─────────────┴──────────────┴──────────────┴─────────────┘
```

## Fee Breakdown (300 SOL Transfer)

```
┌────────────────────────────────────────┐
│  COST BREAKDOWN                        │
├────────────────────────────────────────┤
│  Amount to Withdraw:    300 SOL        │
│  + Privacy Fee:         0.25 NOC       │
│  + Network Fees:        ~0.00005 SOL   │
├────────────────────────────────────────┤
│  RECEIVED:              300 SOL        │
│  COST:                  ~0.00005 SOL   │
│                         0.25 NOC       │
│                                        │
│  Note: Privacy fee applies to         │
│        final withdrawal, not           │
│        consolidation steps!            │
└────────────────────────────────────────┘
```

## Error Recovery Flow

```
┌────────────────────────────────────┐
│  CONSOLIDATION STEP FAILS          │
│  (Proof generation timeout)        │
└────────────────────────────────────┘
            ↓
    ┌───────────────────┐
    │  Retry Logic:     │
    │  - Pause 5 sec    │
    │  - Reconnect      │
    │  - Retry proof    │
    └───────────────────┘
            ↓
        ┌─────────┐
        │ Success?│
        └────┬────┘
       ╭────┴─────╮
       │           │
      YES         NO
       │           │
       ✓           ├─→ Max retries?
    Continue       │   
       │          ╭┴────╮
       │          │      │
       │         YES    NO
       │          │      │
       │      ┌───┴──┐   │
       │      │ERROR │   │
       │      │ABORT │   ├─→ Retry again
       │      └──────┘   │
       │                 │
       ↓              (loop)
    Next Batch
```

## Comparison: Before vs After

```
BEFORE CONSOLIDATION FEATURE:
═════════════════════════════
  User deposits 300 times (300 SOL)
          ↓
  Has 300 notes
          ↓
  Tries to withdraw:
  "Cannot use 300 notes - circuit supports max 4"
          ↓
  Manual options:
  - Consolidate manually (complex, time-consuming)
  - Make smaller withdrawals (multiple txs, multiple fees)
  - Give up (frustrated)

AFTER CONSOLIDATION FEATURE:
════════════════════════════
  User deposits 300 times (300 SOL)
          ↓
  Has 300 notes
          ↓
  Clicks "Withdraw 300 SOL"
          ↓
  App: "Working on consolidation... (automatic)"
          ↓
  28-35 minutes later...
          ↓
  "Withdrawal successful! You received 300 SOL"
          ↓
  ✅ Single transaction
  ✅ Single privacy fee
  ✅ No manual steps
  ✅ User happy!
```

---

**Visual Guide Version**: 1.0  
**Last Updated**: January 11, 2026  
**For Questions**: See CONSOLIDATION_FEATURE.md
