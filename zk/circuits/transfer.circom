pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// Shielded Transfer: spend one note, create two new notes (recipient + change)
// Proves: inputAmount = outputAmount1 + outputAmount2
template ShieldedTransfer() {
    var TREE_HEIGHT = 20;
    
    // Input note secrets
    signal input inSecret;
    signal input inAmount;
    signal input tokenMint;
    signal input blinding;
    signal input rho;
    
    // Merkle proof for input note
    signal input pathElements[TREE_HEIGHT];
    signal input pathIndices[TREE_HEIGHT];
    signal input merkleRoot;
    
    // Output note 1 (recipient)
    signal input outSecret1;
    signal input outAmount1;
    signal input outBlinding1;
    
    // Output note 2 (change back to sender)
    signal input outSecret2;
    signal input outAmount2;
    signal input outBlinding2;
    
    // Public signals
    signal input nullifier;

    // 1. Verify input note commitment exists in tree
    component noteHash = Poseidon(4);
    noteHash.inputs[0] <== inSecret;
    noteHash.inputs[1] <== inAmount;
    noteHash.inputs[2] <== tokenMint;
    noteHash.inputs[3] <== blinding;

    component treeCheck = MerkleTreeInclusionProof(TREE_HEIGHT);
    treeCheck.leaf <== noteHash.out;
    for (var i = 0; i < TREE_HEIGHT; i++) {
        treeCheck.pathElements[i] <== pathElements[i];
        treeCheck.pathIndex[i] <== pathIndices[i];
    }
    treeCheck.root === merkleRoot;

    // 2. Verify nullifier is correctly derived
    component newNullifier = Poseidon(2);
    newNullifier.inputs[0] <== inSecret;
    newNullifier.inputs[1] <== rho;
    nullifier === newNullifier.out;

    // 3. CRITICAL: Verify amounts balance (no inflation)
    inAmount === outAmount1 + outAmount2;

    // 4. Compute output commitment 1 (recipient note)
    component outNoteHash1 = Poseidon(4);
    outNoteHash1.inputs[0] <== outSecret1;
    outNoteHash1.inputs[1] <== outAmount1;
    outNoteHash1.inputs[2] <== tokenMint;  // same token
    outNoteHash1.inputs[3] <== outBlinding1;

    // 5. Compute output commitment 2 (change note)
    component outNoteHash2 = Poseidon(4);
    outNoteHash2.inputs[0] <== outSecret2;
    outNoteHash2.inputs[1] <== outAmount2;
    outNoteHash2.inputs[2] <== tokenMint;  // same token
    outNoteHash2.inputs[3] <== outBlinding2;

    // Output commitments as public signals
    signal output outCommitment1;
    signal output outCommitment2;
    outCommitment1 <== outNoteHash1.out;
    outCommitment2 <== outNoteHash2.out;
}

component main { public [merkleRoot, nullifier] } = ShieldedTransfer();
