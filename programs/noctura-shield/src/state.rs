use anchor_lang::prelude::*;

pub const MAX_TREE_HEIGHT: u8 = 14; // 16k leaves (reduced for account size constraints)
pub const MAX_ROOT_HISTORY: usize = 32;
pub const MAX_NULLIFIERS: usize = 256; // Keep at 256 for account compatibility
pub const MAX_VERIFIER_BYTES: usize = 4096;

#[account]
pub struct GlobalState {
    pub admin: Pubkey,
    pub fee_collector: Pubkey,
    pub shield_fee_bps: u16,
    pub priority_fee_bps: u16,
    pub tree: Pubkey,
    pub nullifier_set: Pubkey,
    pub verifier: Pubkey,
    pub bump: u8,
}

impl GlobalState {
    pub const LEN: usize = 8 + (32 * 5) + 2 + 2 + 1;
}

#[account]
pub struct MerkleTreeAccount {
    pub height: u8,
    pub current_index: u32,
    pub filled_subtrees: Vec<[u8; 32]>,
    pub cached_roots: Vec<[u8; 32]>,
}

impl MerkleTreeAccount {
    pub fn space(height: u8) -> usize {
        let vec_overhead = 4; // Anchor stores Vec len as u32
        8 // discriminator
        + 1 // height
        + 4 // current_index
        + vec_overhead + (height as usize * 32)
        + vec_overhead + (MAX_ROOT_HISTORY * 32)
    }
}

#[account]
pub struct NullifierSetAccount {
    pub nullifiers: Vec<[u8; 32]>,
}

impl NullifierSetAccount {
    pub const fn space() -> usize {
        8 + 4 + (MAX_NULLIFIERS * 32)
    }
}

#[account]
pub struct VerifierAccount {
    pub verifying_key: Vec<u8>,
}

impl VerifierAccount {
    pub const fn space() -> usize {
        8 + 4 + MAX_VERIFIER_BYTES
    }
}
