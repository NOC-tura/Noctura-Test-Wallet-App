import { describe, it, expect, beforeEach, vi } from 'vitest';
import { generateSecureRandomBytes, generateCommitmentRandomness, verifyEntropyQuality } from '../utils/crypto';
import { generateSecureRandomness } from '../utils/privacy';
import { calculateNOCFee, SOL_FEE_LAMPORTS, validateMinimumNOC } from '../utils/fees';
import { selectNotesForAmount } from '../utils/noteSelection';
import { ShieldedNoteRecord } from '../types/shield';

// Mock circomlibjs to avoid node crypto issues
vi.mock('circomlibjs', () => ({
  buildPoseidon: vi.fn(() => Promise.resolve({
    F: {
      toObject: (x: bigint) => x,
    },
    default: (inputs: bigint[]) => inputs.reduce((acc, val) => acc + val, 0n),
  })),
}));

describe('Crypto utilities', () => {
  it('generates secure random bytes', () => {
    const bytes = generateSecureRandomBytes(32);
    expect(bytes.length).toBe(32);
  });

  it('generates commitment randomness', () => {
    const randomness = generateCommitmentRandomness();
    expect(randomness.length).toBe(32);
  });

  it('verifies entropy quality', () => {
    const good = new Uint8Array([1, 2, 3, 4, 5]);
    expect(verifyEntropyQuality(good)).toBe(true);
    
    const allZeros = new Uint8Array([0, 0, 0, 0, 0]);
    expect(verifyEntropyQuality(allZeros)).toBe(false);
    
    const allSame = new Uint8Array([7, 7, 7, 7, 7]);
    expect(verifyEntropyQuality(allSame)).toBe(false);
  });
});

describe('Privacy ZK-hash', () => {
  it('generates secure randomness', () => {
    const randomness = generateSecureRandomness();
    expect(randomness.length).toBe(32);
    expect(verifyEntropyQuality(randomness)).toBe(true);
  });

  // Note: Full ZK-hash tests require circomlibjs which has node crypto dependencies
  // These are tested in browser environment during runtime
});

describe('Fee calculation', () => {
  it('calculates base NOC fee', () => {
    const fee = calculateNOCFee('transfer', 1, false);
    expect(fee).toBe(0.05);
  });

  it('increases fee with complexity', () => {
    const base = calculateNOCFee('transfer', 1, false);
    const complex = calculateNOCFee('transfer', 6, false);
    expect(complex).toBeGreaterThan(base);
  });

  it('adds priority lane fee', () => {
    const normal = calculateNOCFee('transfer', 1, false);
    const priority = calculateNOCFee('transfer', 1, true);
    expect(priority).toBe(normal + 0.15);
  });

  it('validates SOL fee constant', () => {
    expect(SOL_FEE_LAMPORTS).toBe(50_000);
  });

  it('validates minimum NOC requirement', () => {
    expect(validateMinimumNOC(0.25)).toBe(true);
    expect(validateMinimumNOC(0.24)).toBe(false);
    expect(validateMinimumNOC(1.0)).toBe(true);
  });
});

describe('Note selection', () => {
  let notes: ShieldedNoteRecord[];

  beforeEach(() => {
    notes = [
      { amount: '1000000000', tokenType: 'SOL', spent: false } as ShieldedNoteRecord,
      { amount: '500000000', tokenType: 'SOL', spent: false } as ShieldedNoteRecord,
      { amount: '250000000', tokenType: 'SOL', spent: false } as ShieldedNoteRecord,
      { amount: '100000000', tokenType: 'SOL', spent: false } as ShieldedNoteRecord,
    ];
  });

  it('selects largest notes first (greedy)', () => {
    const result = selectNotesForAmount(1200000000n, notes, 'SOL');
    expect(result.selectedNotes.length).toBe(2);
    expect(result.selectedNotes[0].amount).toBe('1000000000');
    expect(result.selectedNotes[1].amount).toBe('500000000');
  });

  it('calculates change correctly', () => {
    const result = selectNotesForAmount(1200000000n, notes, 'SOL');
    expect(result.changeAmount).toBe(300000000n);
  });

  it('throws error when insufficient funds', () => {
    expect(() => selectNotesForAmount(2000000000n, notes, 'SOL')).toThrow('Insufficient SOL');
  });

  it('respects maxNotes limit', () => {
    // With only 2 notes allowed, we can only get 1.5 SOL (not enough for 1.7 SOL)
    expect(() => selectNotesForAmount(1700000000n, notes, 'SOL', 2)).toThrow('Insufficient SOL');
  });

  it('filters spent notes', () => {
    notes[0].spent = true;
    const result = selectNotesForAmount(600000000n, notes, 'SOL');
    expect(result.selectedNotes[0].amount).toBe('500000000');
  });
});

describe('Multi-note 12×1 SOL scenario', () => {
  it('demonstrates 4-note circuit cap limitation', () => {
    const notes: ShieldedNoteRecord[] = Array.from({ length: 12 }, () => ({
      amount: '1000000000', // 1 SOL each
      tokenType: 'SOL',
      spent: false,
    } as ShieldedNoteRecord));
    
    const targetAmount = 11999950000n; // 11.99995 SOL (12 SOL - 0.00005 SOL fee)
    
    // With 4-note limit, we can only combine 4 notes at a time
    // This demonstrates the circuit limitation that prevents full 12-note consolidation
    expect(() => selectNotesForAmount(targetAmount, notes, 'SOL', 4)).toThrow('Insufficient SOL');
    
    // But we CAN select 4 notes successfully (4 SOL)
    const result = selectNotesForAmount(4000000000n, notes, 'SOL', 4);
    expect(result.selectedNotes.length).toBe(4);
    expect(result.totalSelected).toBe(4000000000n);
  });

  it('validates insufficient notes with circuit cap', () => {
    const notes: ShieldedNoteRecord[] = Array.from({ length: 12 }, () => ({
      amount: '1000000000',
      tokenType: 'SOL',
      spent: false,
    } as ShieldedNoteRecord));
    
    const targetAmount = 5000000000n; // 5 SOL (needs 5 notes but cap is 4)
    
    expect(() => selectNotesForAmount(targetAmount, notes, 'SOL', 4)).toThrow('Insufficient SOL');
  });
});
