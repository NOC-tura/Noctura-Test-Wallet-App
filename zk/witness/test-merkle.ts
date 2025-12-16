import { poseidonHash, TREE_HEIGHT, ZERO } from './constants.js';
import { IncrementalMerkleTree } from './merkle.js';

const leaf = 12345n;

// Compute expected root manually
const zeroHashes = [ZERO];
for (let i = 1; i <= TREE_HEIGHT; i++) {
  zeroHashes.push(poseidonHash([zeroHashes[i-1], zeroHashes[i-1]]));
}

let expectedRoot = leaf;
for (let level = 0; level < TREE_HEIGHT; level++) {
  expectedRoot = poseidonHash([expectedRoot, zeroHashes[level]]);
}
console.log('Expected root:', expectedRoot.toString());

// Test tree
const tree = new IncrementalMerkleTree();
tree.append(leaf);
console.log('Tree root:', tree.root().toString());
console.log('Root match:', tree.root() === expectedRoot);

// Generate proof
const proof = tree.generateProof(0);
console.log('\nPath elements (first 5):', proof.pathElements.slice(0, 5).map(x => x.toString()));
console.log('Expected zeros (first 5):', zeroHashes.slice(0, 5).map(x => x.toString()));

// Verify proof
let verify = leaf;
for (let i = 0; i < TREE_HEIGHT; i++) {
  const sibling = proof.pathElements[i];
  if (proof.pathIndices[i] === 0) {
    verify = poseidonHash([verify, sibling]);
  } else {
    verify = poseidonHash([sibling, verify]);
  }
}
console.log('\nVerified root:', verify.toString());
console.log('Proof root:', proof.root.toString());
console.log('Verification match:', verify === proof.root);
