use anchor_lang::prelude::*;

#[error_code]
pub enum ShieldError {
    #[msg("Caller is not authorized to perform this action")]
    Unauthorized,
    #[msg("Amount must be greater than zero")]
    InvalidAmount,
    #[msg("Merkle tree is full")]
    TreeFull,
    #[msg("Failed to verify Groth16 proof")]
    InvalidProof,
    #[msg("Nullifier has already been used")]
    NullifierUsed,
    #[msg("Vector capacity exceeded")]
    CapacityExceeded,
    #[msg("Verifier account has not been configured")]
    VerifierMissing,
    #[msg("Verifier parameters are malformed")]
    InvalidVerifierKey,
}
