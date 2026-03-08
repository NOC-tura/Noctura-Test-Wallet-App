import { Note, createNote } from '../note.js';
import { MerkleProof } from '../merkle.js';

export interface SwapV2WitnessInput {
  inputNote: Note;           // The full note being consumed
  merkleProof: MerkleProof;
  swapAmount: bigint;        // Amount being swapped (can be less than input)
  expectedOutAmount: bigint; // AMM-calculated output amount
  outTokenMint: bigint;      // Output token type
  outSecret: bigint;         // Secret for output note
  outBlinding: bigint;       // Blinding for output note
  changeSecret: bigint;      // Secret for change note
  changeBlinding: bigint;    // Blinding for change note
}

export interface SwapV2Witness {
  // Input note
  inSecret: string;
  inAmount: string;
  inTokenMint: string;
  inBlinding: string;
  inRho: string;
  // Merkle proof
  pathElements: string[];
  pathIndices: string[];
  merkleRoot: string;
  // Swap parameters
  swapAmount: string;
  expectedOutAmount: string;
  // Output 1: Swapped token
  outSecret: string;
  outAmount: string;
  outTokenMint: string;
  outBlinding: string;
  // Output 2: Change (same token as input)
  changeSecret: string;
  changeAmount: string;
  changeBlinding: string;
  // Public inputs
  nullifier: string;
}

export function serializeSwapV2Witness({ 
  inputNote, 
  merkleProof, 
  swapAmount,
  expectedOutAmount,
  outTokenMint,
  outSecret,
  outBlinding,
  changeSecret,
  changeBlinding,
}: SwapV2WitnessInput): SwapV2Witness {
  // Change amount = input amount - swap amount
  const changeAmount = inputNote.amount - swapAmount;
  
  return {
    // Input note
    inSecret: inputNote.secret.toString(),
    inAmount: inputNote.amount.toString(),
    inTokenMint: inputNote.tokenMint.toString(),
    inBlinding: inputNote.blinding.toString(),
    inRho: inputNote.rho.toString(),
    // Merkle proof
    pathElements: merkleProof.pathElements.map((x) => x.toString()),
    pathIndices: merkleProof.pathIndices.map((x) => x.toString()),
    merkleRoot: merkleProof.root.toString(),
    // Swap parameters
    swapAmount: swapAmount.toString(),
    expectedOutAmount: expectedOutAmount.toString(),
    // Output 1: Swapped token
    outSecret: outSecret.toString(),
    outAmount: expectedOutAmount.toString(),
    outTokenMint: outTokenMint.toString(),
    outBlinding: outBlinding.toString(),
    // Output 2: Change
    changeSecret: changeSecret.toString(),
    changeAmount: changeAmount.toString(),
    changeBlinding: changeBlinding.toString(),
    // Public inputs
    nullifier: inputNote.nullifier.toString(),
  };
}

export function serializeSwapV2PublicInputs(witness: SwapV2Witness): [bigint, bigint, bigint, bigint] {
  return [
    BigInt(witness.merkleRoot),
    BigInt(witness.nullifier),
    BigInt(witness.expectedOutAmount),
    BigInt(witness.swapAmount),
  ];
}
