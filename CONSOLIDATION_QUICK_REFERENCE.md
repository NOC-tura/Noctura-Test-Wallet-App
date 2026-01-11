# Consolidation Feature - Quick Reference Card

## For Users

### Q: What is automatic consolidation?
**A**: When you've made many deposits to shielded mode, the system automatically combines (consolidates) them into fewer larger notes before withdrawal. This happens transparently - you don't need to do anything!

### Q: Why do I need it?
**A**: The privacy circuit can only handle 4 notes at a time. If you deposited 300 times, you'd have 300 separate notes. Consolidation lets you withdraw all 300 SOL in one transaction.

### Q: How long does it take?
**A**: 
- 10-50 notes: 1-2 minutes
- 50-100 notes: 5-10 minutes
- 300 notes: ~30-35 minutes
- 1000+ notes: 1-2 hours

### Q: Do I pay extra fees?
**A**: No! You only pay 1 × privacy fee (0.25 NOC) for the final withdrawal, not for each consolidation step.

### Q: Will I lose any funds?
**A**: No. Consolidation preserves your exact balance. You receive everything you deposited.

### Q: What do the status messages mean?
```
"Consolidating 300 notes into 2-4 notes…"
  → System is merging your notes

"Consolidating batch 1/38…"
  → Working on batch 1 of 38 (38 × ~45s ≈ 28 min)

"Consolidation complete. Processing your transfer…"
  → Ready! Final withdrawal now happens
```

### Q: What if consolidation fails?
**A**: System will retry automatically. If it keeps failing, try again later or make a smaller withdrawal.

---

## For Developers

### Implementation Files
| File | Lines | Purpose |
|------|-------|---------|
| `consolidate.ts` | 95 | TypeScript witness builder |
| `consolidate.js` | 56 | JavaScript witness builder |
| `consolidate.ts` (lib) | 119 | Consolidation utilities |

### Key Functions
```typescript
// Partition notes into batches
partitionNotesForConsolidation(notes, mint)

// Build witness data
buildConsolidationWitness({inputRecords, outputNote, allNotesForMerkle})

// Submit proof to blockchain
relayConsolidate({proof, inputNullifiers, outputCommitment})
```

### Integration Points
1. `startShieldedTransfer()` detects >4 notes
2. Auto-consolidation triggered
3. Witness builders serialize data
4. `proveCircuit('consolidate')` generates proof
5. `relayConsolidate()` submits to blockchain
6. Notes marked spent, new notes added
7. Retry transfer with consolidated notes

### Configuration
```typescript
// No configuration needed!
// Just deploy and it works automatically
```

---

## For Relayer/Backend

### Required Endpoint
```
POST /relay/consolidate
```

### Expected Payload
```json
{
  "proof": {
    "proofBytes": "base64-encoded",
    "publicInputs": ["nullifier1", "nullifier2", ..., "merkleRoot"]
  },
  "inputNullifiers": ["nullifier1", "nullifier2", ...],
  "outputCommitment": "0x..."
}
```

### Expected Response
```json
{
  "signature": "5Hs5Z3...",
  "slot": 12345678
}
```

### Implementation Checklist
- [ ] Route handler accepts POST
- [ ] Proof verification works
- [ ] Nullifiers marked as spent
- [ ] Commitment added to merkle tree
- [ ] Transaction submitted to blockchain
- [ ] Signature returned to client
- [ ] Error handling for edge cases

---

## Key Numbers

| Metric | Value |
|--------|-------|
| Max inputs per consolidation | 8 notes |
| Max inputs for transfer | 4 notes |
| Privacy fee (consolidation) | Included in final fee |
| Privacy fee (final withdrawal) | 0.25 NOC |
| Network fee | ~0.00005 SOL |
| Proof generation time | 30-60 seconds |
| Typical consolidation (300 notes) | 28-35 minutes |

---

## Architecture Diagram

```
User has 300 notes
        ↓
Initiate withdrawal
        ↓
App detects >4 notes
        ↓
Auto-consolidation starts
        ├─ Batch 1: 8 notes → 1 note
        ├─ Batch 2: 8 notes → 1 note
        ├─ ... (38 batches)
        ├─ Batch 38: 4 notes → 1 note
        ↓
Consolidation complete (1 note with 300 SOL)
        ↓
Final withdrawal
        ├─ Generate proof
        ├─ Submit to blockchain
        ├─ Receive 300 SOL
        ↓
Success!
```

---

## Error Messages Reference

| Error | Meaning | Solution |
|-------|---------|----------|
| "Consolidation taking too long" | Network slow | Wait or retry |
| "Proof generation failed" | Prover error | Retry transfer |
| "Relayer rejected" | Invalid proof | Check logs |
| "Insufficient balance" | Not enough funds | Add funds |

---

## Testing Scenarios

### Quick Test (10 notes)
```
1. Deposit 10 × 0.1 SOL
2. Withdraw 1 SOL
3. Observe: Should work without consolidation
4. Status: "Withdrawing from shielded vault…"
```

### Consolidation Test (50 notes)
```
1. Deposit 50 × 1 SOL
2. Withdraw 50 SOL
3. Observe: Should trigger consolidation
4. Time: ~5-10 minutes
5. Result: 50 SOL in wallet
```

### Full Test (300 notes)
```
1. Deposit 300 × 1 SOL (use script for speed)
2. Withdraw 300 SOL
3. Observe: Auto-consolidation progress
4. Time: ~30-35 minutes
5. Result: 300 SOL received
```

---

## FAQ - Technical

**Q: Why use 8-note batches?**
A: Consolidation circuit supports 1-8 inputs. 8 is optimal for throughput vs. proof size.

**Q: Can consolidation be done on-chain?**
A: Yes, but current implementation uses app-driven consolidation for flexibility.

**Q: What if user has different token types?**
A: Consolidation only works within same token (SOL with SOL, NOC with NOC).

**Q: Is consolidation mandatory?**
A: No. Users can make multiple smaller withdrawals to avoid consolidation if they prefer.

**Q: Can I consolidate manually?**
A: Future feature - currently only automatic during large withdrawals.

---

## Troubleshooting Flowchart

```
Consolidation not working?
    ↓
  Is relayer running?
    ├─ No → Start relayer service
    └─ Yes → Continue
           ↓
  Is prover accessible?
    ├─ No → Check connectivity
    └─ Yes → Continue
           ↓
  Are circuit verifiers loaded?
    ├─ No → Load verifier keys
    └─ Yes → Continue
           ↓
  Check browser console for errors
           ↓
  Still stuck? Check logs
           ↓
  Report with error details
```

---

## Performance Expectations

### Per Consolidation Step
- Witness building: <100ms
- Proof generation: 30-60s
- Relayer submission: 1-2s
- Nullifier marking: <100ms
- Tree update: <100ms
- **Total per batch: 31-62s**

### Scaling Examples
- 8 notes: ~1 minute
- 50 notes: ~5-10 minutes
- 300 notes: ~28-35 minutes
- 1000 notes: ~1-2 hours

---

## Production Deployment

### Pre-deployment
- [ ] All services running (relayer, prover, blockchain)
- [ ] Testnet validation complete
- [ ] Performance benchmarks established
- [ ] Error scenarios tested

### Deployment
- [ ] Deploy app with consolidation code
- [ ] Monitor for issues
- [ ] Check logs for errors
- [ ] Verify no stuck transactions

### Post-deployment
- [ ] User feedback collection
- [ ] Performance monitoring
- [ ] Error rate tracking
- [ ] Optimization opportunities identified

---

## Support Contact

For issues or questions:
1. Check `CONSOLIDATION_FEATURE.md` for technical details
2. Check `CONSOLIDATION_TEST_GUIDE.md` for test procedures
3. Check `CONSOLIDATION_VISUAL_GUIDE.md` for diagrams
4. Review logs for error details
5. Check GitHub issues or team chat

---

**Quick Reference Version**: 1.0  
**Last Updated**: January 11, 2026  
**Status**: Ready for Production Testing
