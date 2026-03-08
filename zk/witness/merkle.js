import { TREE_HEIGHT, ZERO, poseidonHash } from './constants.js';
// Precompute zero hashes for each level
// zeroHashes[0] = 0 (empty leaf)
// zeroHashes[i] = hash(zeroHashes[i-1], zeroHashes[i-1])
function computeZeroHashes(height) {
    const zeros = [ZERO];
    for (let i = 1; i <= height; i++) {
        zeros.push(poseidonHash([zeros[i - 1], zeros[i - 1]]));
    }
    return zeros;
}
const ZERO_HASHES = computeZeroHashes(TREE_HEIGHT);
export class IncrementalMerkleTree {
    height;
    nodes;
    nextLeafIndex = 0;
    zeroHashes;
    constructor(height = TREE_HEIGHT) {
        this.height = height;
        this.zeroHashes = ZERO_HASHES.slice(0, height + 1);
        // We need height+1 levels:
        // Level 0 = leaves (2^height elements)
        // Level height = root (1 element)
        this.nodes = Array.from({ length: height + 1 }, (_, level) => {
            const length = 1 << (height - level);
            // At level i, empty positions should have zeroHashes[i]
            return new Array(length).fill(this.zeroHashes[level]);
        });
    }
    append(leaf) {
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
    root() {
        return this.nodes[this.height][0];
    }
    generateProof(index) {
        if (index >= this.nextLeafIndex) {
            throw new Error('Leaf not inserted yet');
        }
        const pathElements = [];
        const pathIndices = [];
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
