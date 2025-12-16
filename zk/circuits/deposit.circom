pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";

// Commits (secret, amount, tokenMint, blinding)
template Deposit() {
    signal input secret;
    signal input amount;
    signal input tokenMint;
    signal input blinding;
    signal input expectedCommitment;

    component poseidon = Poseidon(4);
    poseidon.inputs[0] <== secret;
    poseidon.inputs[1] <== amount;
    poseidon.inputs[2] <== tokenMint;
    poseidon.inputs[3] <== blinding;

    signal output commitment;
    commitment <== poseidon.out;
    expectedCommitment === commitment;
}

component main { public [expectedCommitment] } = Deposit();
