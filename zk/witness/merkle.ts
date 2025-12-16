import { TREE_HEIGHT, ZERO, poseidonHash } from './constants.js';

export type MerkleProof = {
  pathElements: bigint[];
  pathIndices: number[];
  root: bigint;
};

// Precompute zero hashes for each level
// zeroHashes[0] = 0 (empty leaf)
// zeroHashes[i] = hash(zeroHashes[i-1], zeroHashes[i-1])
function computeZeroHashes(height: number): bigint[] {
  const zeros: bigint[] = [ZERO];
  for (let i = 1; i <= height; i++) {
    zeros.push(poseidonHash([zeros[i - 1], zeros[i - 1]]));
  }
  return zeros;
}

const ZERO_HASHES = computeZeroHashes(TREE_HEIGHT);

export class IncrementalMerkleTree {
  private nodes: bigint[][];
  private nextLeafIndex = 0;
  private zeroHashes: bigint[];

  constructor(public readonly height = TREE_HEIGHT) {
    this.zeroHashes = ZERO_HASHES.slice(0, height + 1);
    // We need height+1 levels:
    // Level 0 = leaves (2^height elements)
    // Level height = root (1 element)
    this.nodes = Array.from({ length: height + 1 }, (_, level) => {
      const length = 1 << (height - level);
      // At level i, empty positions should have zeroHashes[i]
      return new Array<bigint>(length).fill(this.zeroHashes[level]);
    });
  }

  append(leaf: bigint) {
    if (this.nextLeafIndex >= 1 << this.height) {
      throw new Error('Merkle tree is full');
    }
    let index = this.nextLeafIndex;
    this.nodes[0][index] = leaf;
    // Propagate from leaves (level 0) up to root (level height)
    for (let level = 0; level < this.height; level++) {
      const parentIndex = Math.floor(index / 2);
      const left = this.nodes[level][parentIndex * 2];
      const right = this.nodes[level][parentIndex * 2 + 1];
      this.nodes[level + 1][parentIndex] = poseidonHash([left, right]);
      index = parentIndex;
    }
    this.nextLeafIndex += 1;
  }

  root(): bigint {
    return this.nodes[this.height][0];
  }

  generateProof(index: number): MerkleProof {
    if (index >= this.nextLeafIndex) {
      throw new Error('Leaf not inserted yet');
    }
    const pathElements: bigint[] = [];
    const pathIndices: number[] = [];
    let currentIndex = index;
    // Generate proof for all levels (from leaves up)
    for (let level = 0; level < this.height; level++) {
      const siblingIndex = currentIndex ^ 1;
      pathElements.push(this.nodes[level][siblingIndex]);
      pathIndices.push(currentIndex % 2);
      currentIndex = Math.floor(currentIndex / 2);
    }
    return { pathElements, pathIndices, root: this.root() };
  }
}
