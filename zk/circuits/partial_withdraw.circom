pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

// Partial Withdrawal: spend one note, withdraw some amount, create change note
// Proves: inputAmount = withdrawAmount + changeAmount
// withdrawAmount goes to recipient's transparent wallet
// changeAmount stays shielded as a new note
template PartialWithdraw() {
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
    
    // Amount to withdraw to transparent wallet
    signal input withdrawAmount;
    
    // Change note (stays shielded)
    signal input changeSecret;
    signal input changeAmount;
    signal input changeBlinding;
    
    // Public signals
    signal input nullifier;
    signal input receiver;  // recipient's wallet address (for transparent withdrawal)

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

    // 2. Verify nullifier is correctly computed
    component nullifierCheck = Poseidon(2);
    nullifierCheck.inputs[0] <== inSecret;
    nullifierCheck.inputs[1] <== rho;
    nullifier === nullifierCheck.out;

    // 3. CRITICAL: Verify amounts balance (no inflation)
    // inputAmount must equal withdrawAmount + changeAmount
    inAmount === withdrawAmount + changeAmount;

    // 4. Compute change note commitment
    component changeNoteHash = Poseidon(4);
    changeNoteHash.inputs[0] <== changeSecret;
    changeNoteHash.inputs[1] <== changeAmount;
    changeNoteHash.inputs[2] <== tokenMint;
    changeNoteHash.inputs[3] <== changeBlinding;

    // 5. Output public signals
    signal output claimedReceiver;
    signal output claimedWithdrawAmount;
    signal output changeCommitment;
    
    claimedReceiver <== receiver;
    claimedWithdrawAmount <== withdrawAmount;
    changeCommitment <== changeNoteHash.out;
}

component main { public [merkleRoot, nullifier, receiver, withdrawAmount] } = PartialWithdraw();
