pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// Multi-note consolidation: spend up to 8 notes, create 1 consolidated output
// This allows users to combine fragmented notes into a single large note
template Consolidate(nInputs) {
    var TREE_HEIGHT = 20;
    assert(nInputs <= 8); // Support up to 8 input notes
    
    // Input notes (array of up to 8)
    signal input inSecrets[nInputs];
    signal input inAmounts[nInputs];
    signal input tokenMint;
    signal input blindings[nInputs];
    signal input rhos[nInputs];
    
    // Merkle proofs for each input note
    signal input pathElements[nInputs][TREE_HEIGHT];
    signal input pathIndices[nInputs][TREE_HEIGHT];
    signal input merkleRoot;
    
    // Output note (consolidated)
    signal input outSecret;
    signal input outBlinding;
    
    // Public signals
    signal input nullifiers[nInputs];
    
    // Sum all input amounts
    signal inputSum;
    signal partialSums[nInputs];
    partialSums[0] <== inAmounts[0];
    for (var i = 1; i < nInputs; i++) {
        partialSums[i] <== partialSums[i-1] + inAmounts[i];
    }
    inputSum <== partialSums[nInputs - 1];
    
    // Verify each input note
    component noteHashes[nInputs];
    component nullifierChecks[nInputs];
    component treeChecks[nInputs];
    
    for (var i = 0; i < nInputs; i++) {
        // Compute note commitment
        noteHashes[i] = Poseidon(4);
        noteHashes[i].inputs[0] <== inSecrets[i];
        noteHashes[i].inputs[1] <== inAmounts[i];
        noteHashes[i].inputs[2] <== tokenMint;
        noteHashes[i].inputs[3] <== blindings[i];
        
        // Verify merkle proof
        treeChecks[i] = MerkleTreeInclusionProof(TREE_HEIGHT);
        treeChecks[i].leaf <== noteHashes[i].out;
        for (var j = 0; j < TREE_HEIGHT; j++) {
            treeChecks[i].pathElements[j] <== pathElements[i][j];
            treeChecks[i].pathIndex[j] <== pathIndices[i][j];
        }
        treeChecks[i].root === merkleRoot;
        
        // Verify nullifier
        nullifierChecks[i] = Poseidon(2);
        nullifierChecks[i].inputs[0] <== inSecrets[i];
        nullifierChecks[i].inputs[1] <== rhos[i];
        nullifiers[i] === nullifierChecks[i].out;
    }
    
    // Create consolidated output note
    component outNoteHash = Poseidon(4);
    outNoteHash.inputs[0] <== outSecret;
    outNoteHash.inputs[1] <== inputSum; // Sum of all inputs
    outNoteHash.inputs[2] <== tokenMint;
    outNoteHash.inputs[3] <== outBlinding;
    
    // Output commitment
    signal output outCommitment;
    outCommitment <== outNoteHash.out;
}

// Instantiate with different input counts
component main {public [nullifiers, merkleRoot]} = Consolidate(8);
