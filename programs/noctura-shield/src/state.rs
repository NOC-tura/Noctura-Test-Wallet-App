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

/// Shielded Liquidity Pool State
/// Implements constant-product AMM (x * y = k) entirely within the shielded system
#[account]
pub struct ShieldedPool {
    /// Admin who can manage pool
    pub admin: Pubkey,
    /// Total shielded SOL in pool (in lamports)
    pub sol_reserve: u64,
    /// Total shielded NOC in pool (in atomic units, 6 decimals)
    pub noc_reserve: u64,
    /// LP token total supply (for tracking liquidity provider shares)
    pub lp_total_supply: u64,
    /// Swap fee in basis points (e.g., 30 = 0.30%)
    pub swap_fee_bps: u16,
    /// Bump seed for PDA
    pub bump: u8,
    /// Pool enabled flag
    pub enabled: bool,
}

impl ShieldedPool {
    pub const LEN: usize = 8 + 32 + 8 + 8 + 8 + 2 + 1 + 1;

    /// Calculate output amount using constant product formula
    /// output = (input * output_reserve * (10000 - fee_bps)) / ((input_reserve + input) * 10000)
    pub fn calculate_output(
        &self,
        input_amount: u64,
        input_is_sol: bool,
    ) -> Option<u64> {
        if input_amount == 0 {
            return None;
        }

        let (input_reserve, output_reserve) = if input_is_sol {
            (self.sol_reserve as u128, self.noc_reserve as u128)
        } else {
            (self.noc_reserve as u128, self.sol_reserve as u128)
        };

        if input_reserve == 0 || output_reserve == 0 {
            return None;
        }

        let input = input_amount as u128;
        let fee_multiplier = 10000u128 - self.swap_fee_bps as u128;

        // output = (input * output_reserve * fee_multiplier) / ((input_reserve + input) * 10000)
        let numerator = input
            .checked_mul(output_reserve)?
            .checked_mul(fee_multiplier)?;
        let denominator = input_reserve
            .checked_add(input)?
            .checked_mul(10000)?;

        let output = numerator.checked_div(denominator)?;
        
        // Ensure output doesn't exceed reserve
        if output >= output_reserve {
            return None;
        }

        Some(output as u64)
    }

    /// Calculate LP tokens to mint for adding liquidity
    pub fn calculate_lp_tokens(
        &self,
        sol_amount: u64,
        noc_amount: u64,
    ) -> Option<u64> {
        if self.lp_total_supply == 0 {
            // Initial liquidity: LP tokens = sqrt(sol * noc)
            let product = (sol_amount as u128).checked_mul(noc_amount as u128)?;
            Some(integer_sqrt(product) as u64)
        } else {
            // Proportional liquidity
            let sol_ratio = (sol_amount as u128)
                .checked_mul(self.lp_total_supply as u128)?
                .checked_div(self.sol_reserve as u128)?;
            let noc_ratio = (noc_amount as u128)
                .checked_mul(self.lp_total_supply as u128)?
                .checked_div(self.noc_reserve as u128)?;
            // Take the minimum to ensure balanced deposit
            Some(std::cmp::min(sol_ratio, noc_ratio) as u64)
        }
    }
}

/// Integer square root using Newton's method
fn integer_sqrt(n: u128) -> u128 {
    if n == 0 {
        return 0;
    }
    let mut x = n;
    let mut y = (x + 1) / 2;
    while y < x {
        x = y;
        y = (x + n / x) / 2;
    }
    x
}

/// LP Position tracking for liquidity providers (stored in Merkle tree as shielded notes)
#[account]
pub struct LPPosition {
    /// Owner's public key (hashed for privacy)
    pub owner_hash: [u8; 32],
    /// LP token amount
    pub lp_amount: u64,
    /// Commitment for this position
    pub commitment: [u8; 32],
}

impl LPPosition {
    pub const LEN: usize = 8 + 32 + 8 + 32;
}

