pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "./merkle.circom";

/**
 * Shielded Pool Swap Circuit
 * 
 * Proves:
 * 1. User owns the input note (can compute correct nullifier)
 * 2. Input note exists in merkle tree
 * 3. Output commitment is correctly formed
 * 
 * The swap ratio is enforced by the AMM on-chain, NOT in the circuit.
 * Circuit only proves note ownership and valid commitment construction.
 * 
 * Input token and output token can be DIFFERENT (that's the point of swap!)
 * 
 * NOTE: Current circuit swaps the ENTIRE input note. User types desired amount,
 * but the full note value is swapped. For partial swaps with change, we would
 * need a new circuit version with 2 outputs (swapped token + change).
 */
template ShieldedSwap() {
    var TREE_HEIGHT = 20;
    
    // === INPUT NOTE (being spent) ===
    signal input inSecret;
    signal input inAmount;
    signal input inTokenMint;  // e.g., NOC
    signal input inBlinding;
    signal input inRho;
    
    // Merkle proof for input note
    signal input pathElements[TREE_HEIGHT];
    signal input pathIndices[TREE_HEIGHT];
    signal input merkleRoot;
    
    // === OUTPUT NOTE (received after swap) ===
    signal input outSecret;
    signal input outAmount;     // Amount calculated by AMM
    signal input outTokenMint;  // Different token! e.g., SOL
    signal input outBlinding;
    
    // === PUBLIC SIGNALS ===
    signal input nullifier;           // Nullifier for spent input note
    signal input expectedOutAmount;   // AMM-calculated output (verified on-chain matches)
    
    // 1. Compute input note commitment
    component inNoteHash = Poseidon(4);
    inNoteHash.inputs[0] <== inSecret;
    inNoteHash.inputs[1] <== inAmount;
    inNoteHash.inputs[2] <== inTokenMint;
    inNoteHash.inputs[3] <== inBlinding;

    // 2. Verify input note exists in merkle tree
    component treeCheck = MerkleTreeInclusionProof(TREE_HEIGHT);
    treeCheck.leaf <== inNoteHash.out;
    for (var i = 0; i < TREE_HEIGHT; i++) {
        treeCheck.pathElements[i] <== pathElements[i];
        treeCheck.pathIndex[i] <== pathIndices[i];
    }
    merkleRoot === treeCheck.root;

    // 3. Verify nullifier is correctly derived
    component computedNullifier = Poseidon(2);
    computedNullifier.inputs[0] <== inSecret;
    computedNullifier.inputs[1] <== inRho;
    nullifier === computedNullifier.out;

    // 4. Verify output amount matches expected (AMM-calculated)
    outAmount === expectedOutAmount;

    // 5. Compute output commitment
    component outNoteHash = Poseidon(4);
    outNoteHash.inputs[0] <== outSecret;
    outNoteHash.inputs[1] <== outAmount;
    outNoteHash.inputs[2] <== outTokenMint;
    outNoteHash.inputs[3] <== outBlinding;

    // === PUBLIC OUTPUTS ===
    signal output inputCommitment;
    signal output outputCommitment;
    signal output inputAmount;
    signal output inputTokenMint;
    signal output outputTokenMint;
    
    inputCommitment <== inNoteHash.out;
    outputCommitment <== outNoteHash.out;
    inputAmount <== inAmount;
    inputTokenMint <== inTokenMint;
    outputTokenMint <== outTokenMint;
}

component main { public [merkleRoot, nullifier, expectedOutAmount] } = ShieldedSwap();
