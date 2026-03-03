export type MerkleProof = {
    pathElements: bigint[];
    pathIndices: number[];
    root: bigint;
};
export declare class IncrementalMerkleTree {
    readonly height: number;
    private nodes;
    private nextLeafIndex;
    private zeroHashes;
    constructor(height?: number);
    append(leaf: bigint): void;
    root(): bigint;
    generateProof(index: number): MerkleProof;
}
