/* eslint-disable @typescript-eslint/no-unused-vars, no-unused-vars */
import { IncrementalMerkleTree } from '@zk-witness/merkle';
import { ShieldedNoteRecord } from '../types/shield';

/**
 * Build a Merkle proof for a target note using Poseidon hashing.
 * 
 * IMPORTANT: The on-chain Merkle tree uses keccak256, but the ZK circuit uses Poseidon.
 * For the circuit proof to verify, we must compute the Merkle path using Poseidon.
 * The on-chain program only verifies the SNARK proof validity and nullifier uniqueness,
 * it does NOT check the merkle root against its on-chain tree.
 * 
 * This function builds a local Poseidon-based tree from all known notes and generates
 * a valid inclusion proof for the target note.
 */
export function buildMerkleProof(notes: ShieldedNoteRecord[], target: ShieldedNoteRecord) {
  console.log('[Merkle] Building proof for target:', target.commitment);
  console.log('[Merkle] Total notes:', notes.length);
  
  const tree = new IncrementalMerkleTree();
  const ordered = [...notes].sort((a, b) => a.leafIndex - b.leafIndex);
  console.log('[Merkle] Ordered notes by leafIndex:', ordered.map(n => n.leafIndex));
  
  // Find the index of the target note in our local ordered list
  let targetTreeIndex = -1;
  ordered.forEach((note, idx) => {
    tree.append(BigInt(note.commitment));
    if (note.commitment === target.commitment) {
      targetTreeIndex = idx;
    }
  });
  
  if (targetTreeIndex === -1) {
    throw new Error('Target note not found in notes list');
  }
  
  console.log('[Merkle] Target found at tree index:', targetTreeIndex);
  const proof = tree.generateProof(targetTreeIndex);
  console.log('[Merkle] Proof generated, root:', proof.root.toString());
  return proof;
}

// Kept for reference - this would be needed if on-chain tree used Poseidon
export async function buildMerkleProofOnChain(
  _keypair: unknown,
  target: ShieldedNoteRecord,
  notes: ShieldedNoteRecord[]
): Promise<{ pathElements: bigint[]; pathIndices: number[]; root: bigint }> {
  // For now, just use local proof since on-chain tree uses keccak, not Poseidon
  return buildMerkleProof(notes, target);
}
