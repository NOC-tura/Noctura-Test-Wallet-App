use anchor_lang::prelude::*;
use solana_program::keccak::hashv;

use crate::{
    errors::ShieldError,
    state::{NullifierSetAccount, MAX_NULLIFIERS},
};

pub fn hash_nodes(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    hashv(&[left, right]).to_bytes()
}

pub fn track_nullifier(set: &mut NullifierSetAccount, nullifier: [u8; 32]) -> Result<()> {
    if set.nullifiers.iter().any(|item| item == &nullifier) {
        return err!(ShieldError::NullifierUsed);
    }
    if set.nullifiers.len() >= MAX_NULLIFIERS {
        return err!(ShieldError::CapacityExceeded);
    }
    set.nullifiers.push(nullifier);
    Ok(())
}

/// Integer square root using Newton's method
pub fn isqrt(n: u128) -> u128 {
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
