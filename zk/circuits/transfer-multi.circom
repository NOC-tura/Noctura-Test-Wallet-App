pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// Multi-Input Shielded Transfer: spend up to 2 notes, create 2 output notes
// Proves: input1 + input2 = output1 + output2 (amount conservation)
template ShieldedTransferMulti() {
    var TREE_HEIGHT = 20;
    
    // Input note 1
    signal input inSecret1;
    signal input inAmount1;
    signal input inBlinding1;
    signal input inRho1;
    
    // Input note 2
    signal input inSecret2;
    signal input inAmount2;
    signal input inBlinding2;
    signal input inRho2;
    
    // Token mint (shared)
    signal input tokenMint;
    
    // Merkle proofs for input notes
    signal input pathElements1[TREE_HEIGHT];
    signal input pathIndices1[TREE_HEIGHT];
    signal input pathElements2[TREE_HEIGHT];
    signal input pathIndices2[TREE_HEIGHT];
    signal input merkleRoot;
    
    // Output note 1 (recipient)
    signal input outSecret1;
    signal input outAmount1;
    signal input outBlinding1;
    
    // Output note 2 (change back to sender)
    signal input outSecret2;
    signal input outAmount2;
    signal input outBlinding2;
    
    // Public signals - nullifiers for both inputs
    signal input nullifier1;
    signal input nullifier2;

    // Verify input note 1
    component noteHash1 = Poseidon(4);
    noteHash1.inputs[0] <== inSecret1;
    noteHash1.inputs[1] <== inAmount1;
    noteHash1.inputs[2] <== tokenMint;
    noteHash1.inputs[3] <== inBlinding1;

    component treeCheck1 = MerkleTreeInclusionProof(TREE_HEIGHT);
    treeCheck1.leaf <== noteHash1.out;
    for (var j = 0; j < TREE_HEIGHT; j++) {
        treeCheck1.pathElements[j] <== pathElements1[j];
        treeCheck1.pathIndex[j] <== pathIndices1[j];
    }
    treeCheck1.root === merkleRoot;

    component nullifierHash1 = Poseidon(2);
    nullifierHash1.inputs[0] <== inSecret1;
    nullifierHash1.inputs[1] <== inRho1;
    nullifier1 === nullifierHash1.out;

    // Verify input note 2
    component noteHash2 = Poseidon(4);
    noteHash2.inputs[0] <== inSecret2;
    noteHash2.inputs[1] <== inAmount2;
    noteHash2.inputs[2] <== tokenMint;
    noteHash2.inputs[3] <== inBlinding2;

    component treeCheck2 = MerkleTreeInclusionProof(TREE_HEIGHT);
    treeCheck2.leaf <== noteHash2.out;
    for (var k = 0; k < TREE_HEIGHT; k++) {
        treeCheck2.pathElements[k] <== pathElements2[k];
        treeCheck2.pathIndex[k] <== pathIndices2[k];
    }
    treeCheck2.root === merkleRoot;

    component nullifierHash2 = Poseidon(2);
    nullifierHash2.inputs[0] <== inSecret2;
    nullifierHash2.inputs[1] <== inRho2;
    nullifier2 === nullifierHash2.out;

    // Verify amount conservation: input1 + input2 = output1 + output2
    signal totalInputAmount <== inAmount1 + inAmount2;
    totalInputAmount === outAmount1 + outAmount2;

    // Compute output commitment 1
    component outNoteHash1 = Poseidon(4);
    outNoteHash1.inputs[0] <== outSecret1;
    outNoteHash1.inputs[1] <== outAmount1;
    outNoteHash1.inputs[2] <== tokenMint;
    outNoteHash1.inputs[3] <== outBlinding1;

    // Compute output commitment 2
    component outNoteHash2 = Poseidon(4);
    outNoteHash2.inputs[0] <== outSecret2;
    outNoteHash2.inputs[1] <== outAmount2;
    outNoteHash2.inputs[2] <== tokenMint;
    outNoteHash2.inputs[3] <== outBlinding2;

    // Output commitments as public signals
    signal output outCommitment1;
    signal output outCommitment2;
    outCommitment1 <== outNoteHash1.out;
    outCommitment2 <== outNoteHash2.out;
}

component main { public [merkleRoot, nullifier1, nullifier2] } = ShieldedTransferMulti();

