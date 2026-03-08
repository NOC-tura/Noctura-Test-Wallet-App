pragma circom 2.1.9;

include "../node_modules/circomlib/circuits/poseidon.circom";
include "../node_modules/circomlib/circuits/comparators.circom";
include "./merkle.circom";

/**
 * Shielded Pool Swap V2 Circuit - WITH CHANGE
 * 
 * User can swap ANY amount from their note, receiving:
 * - Output 1: Swapped tokens (different token type)
 * - Output 2: Change (same token type as input)
 * 
 * Example: User has 300 NOC note, wants to swap 170 NOC
 * - Input: 300 NOC note
 * - Output 1: X SOL (calculated by pool AMM)
 * - Output 2: 130 NOC change
 * 
 * Proves:
 * 1. User owns the input note (can compute correct nullifier)
 * 2. Input note exists in merkle tree
 * 3. Swap amount <= input amount (no over-spending)
 * 4. Output commitments are correctly formed
 * 5. Change = input - swap amount (conservation of funds)
 */
template ShieldedSwapV2() {
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
    
    // === SWAP PARAMETERS ===
    signal input swapAmount;      // Amount user wants to swap (e.g., 170 NOC)
    signal input expectedOutAmount; // AMM-calculated output
    
    // === OUTPUT 1: SWAPPED TOKEN ===
    signal input outSecret;
    signal input outAmount;       // Must equal expectedOutAmount
    signal input outTokenMint;    // Different token! e.g., SOL
    signal input outBlinding;
    
    // === OUTPUT 2: CHANGE (same token as input) ===
    signal input changeSecret;
    signal input changeAmount;    // Must equal inAmount - swapAmount
    signal input changeBlinding;
    
    // === PUBLIC SIGNALS ===
    signal input nullifier;       // Nullifier for spent input note
    
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

    // 4. Verify swap amount <= input amount (no over-spending)
    component canSwap = LessEqThan(252);
    canSwap.in[0] <== swapAmount;
    canSwap.in[1] <== inAmount;
    canSwap.out === 1;

    // 5. Verify change amount is correct (conservation)
    changeAmount === inAmount - swapAmount;

    // 6. Verify output amount matches expected (AMM-calculated)
    outAmount === expectedOutAmount;

    // 7. Compute output commitment (swapped token)
    component outNoteHash = Poseidon(4);
    outNoteHash.inputs[0] <== outSecret;
    outNoteHash.inputs[1] <== outAmount;
    outNoteHash.inputs[2] <== outTokenMint;
    outNoteHash.inputs[3] <== outBlinding;

    // 8. Compute change commitment (same token as input)
    component changeNoteHash = Poseidon(4);
    changeNoteHash.inputs[0] <== changeSecret;
    changeNoteHash.inputs[1] <== changeAmount;
    changeNoteHash.inputs[2] <== inTokenMint;  // Same token mint as input!
    changeNoteHash.inputs[3] <== changeBlinding;

    // === PUBLIC OUTPUTS ===
    signal output inputCommitment;
    signal output outputCommitment;
    signal output changeCommitment;
    signal output publicSwapAmount;
    signal output inputTokenMint;
    signal output outputTokenMint;
    
    inputCommitment <== inNoteHash.out;
    outputCommitment <== outNoteHash.out;
    changeCommitment <== changeNoteHash.out;
    publicSwapAmount <== swapAmount;
    inputTokenMint <== inTokenMint;
    outputTokenMint <== outTokenMint;
}

component main { public [merkleRoot, nullifier, expectedOutAmount, swapAmount] } = ShieldedSwapV2();
