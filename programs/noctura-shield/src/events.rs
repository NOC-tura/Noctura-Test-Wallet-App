use anchor_lang::prelude::*;

#[event]
pub struct CommitmentInserted {
    pub commitment: [u8; 32],
    pub nullifier: [u8; 32],
    pub new_root: [u8; 32],
    pub is_priority: bool,
}

#[event]
pub struct NullifierConsumed {
    pub nullifier: [u8; 32],
}
