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

#[event]
pub struct ShieldedPoolInitialized {
    pub admin: Pubkey,
    pub swap_fee_bps: u16,
}

#[event]
pub struct ShieldedPoolSeeded {
    pub noc_reserve: u64,
    pub sol_reserve: u64,
}

#[event]
pub struct ShieldedSwapExecuted {
    pub input_nullifier: [u8; 32],
    pub output_commitment: [u8; 32],
    pub is_noc_to_sol: bool,
    pub input_amount: u64,
    pub output_amount: u64,
}

#[event]
pub struct ShieldedSwapV2Executed {
    pub input_nullifier: [u8; 32],
    pub output_commitment: [u8; 32],
    pub change_commitment: [u8; 32],
    pub is_noc_to_sol: bool,
    pub swap_amount: u64,
    pub output_amount: u64,
}

#[event]
pub struct TransparentSwapExecuted {
    pub user: Pubkey,
    pub is_sol_to_noc: bool,
    pub input_amount: u64,
    pub output_amount: u64,
}
