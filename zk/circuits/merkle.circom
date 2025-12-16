pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";

template MerkleTreeInclusionProof(levels) {
    signal input leaf;
    signal input pathElements[levels];
    signal input pathIndex[levels];
    signal output root;

    signal current[levels + 1];
    signal pathBits[levels];
    signal invBits[levels];
    signal left[levels];
    signal right[levels];
    signal leftFromCurrent[levels];
    signal leftFromSibling[levels];
    signal rightFromCurrent[levels];
    signal rightFromSibling[levels];
    component hashers[levels];

    current[0] <== leaf;
    for (var i = 0; i < levels; i++) {
        pathBits[i] <== pathIndex[i];
        // Constrain path bits to {0,1}
        pathBits[i] * (pathBits[i] - 1) === 0;
        invBits[i] <== 1 - pathBits[i];

        leftFromCurrent[i] <== invBits[i] * current[i];
        leftFromSibling[i] <== pathBits[i] * pathElements[i];
        left[i] <== leftFromCurrent[i] + leftFromSibling[i];

        rightFromCurrent[i] <== pathBits[i] * current[i];
        rightFromSibling[i] <== invBits[i] * pathElements[i];
        right[i] <== rightFromCurrent[i] + rightFromSibling[i];

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        current[i + 1] <== hashers[i].out;
    }

    root <== current[levels];
}
