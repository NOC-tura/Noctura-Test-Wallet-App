pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

template Withdraw() {
    var TREE_HEIGHT = 20;
    signal input inSecret;
    signal input inAmount;
    signal input tokenMint;
    signal input blinding;
    signal input rho;
    signal input pathElements[TREE_HEIGHT];
    signal input pathIndices[TREE_HEIGHT];
    signal input merkleRoot;
    signal input receiver;
    signal input nullifier;

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

    component newNullifier = Poseidon(2);
    newNullifier.inputs[0] <== inSecret;
    newNullifier.inputs[1] <== rho;
    nullifier === newNullifier.out;

    signal output claimedReceiver;
    signal output claimedAmount;
    claimedReceiver <== receiver;
    claimedAmount <== inAmount;
}

component main { public [merkleRoot, receiver, nullifier] } = Withdraw();
