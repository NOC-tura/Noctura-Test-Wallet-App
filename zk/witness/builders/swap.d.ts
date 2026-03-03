import { Note } from '../note.js';
import { MerkleProof } from '../merkle.js';
export interface SwapWitnessInput {
    inputNote: Note;
    merkleProof: MerkleProof;
    outAmount: bigint;
    outTokenMint: bigint;
    outSecret: bigint;
    outBlinding: bigint;
}
export interface SwapWitness {
    inSecret: string;
    inAmount: string;
    inTokenMint: string;
    inBlinding: string;
    inRho: string;
    pathElements: string[];
    pathIndices: string[];
    merkleRoot: string;
    outSecret: string;
    outAmount: string;
    outTokenMint: string;
    outBlinding: string;
    nullifier: string;
    expectedOutAmount: string;
}
export declare function serializeSwapWitness({ inputNote, merkleProof, outAmount, outTokenMint, outSecret, outBlinding, }: SwapWitnessInput): SwapWitness;
export declare function serializeSwapPublicInputs(witness: SwapWitness): [bigint, bigint, bigint];
