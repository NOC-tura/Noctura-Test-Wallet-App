use anchor_lang::prelude::*;

use crate::{
    errors::ShieldError,
    state::{MerkleTreeAccount, MAX_ROOT_HISTORY},
    utils::hash_nodes,
};

impl MerkleTreeAccount {
    pub fn initialize(&mut self, height: u8) -> Result<()> {
        require!(height > 0, ShieldError::CapacityExceeded);
        self.height = height;
        self.current_index = 0;
        self.filled_subtrees = default_zero_hashes(height);
        self.cached_roots = vec![self.filled_subtrees[(height - 1) as usize]];
        Ok(())
    }

    pub fn append_leaf(&mut self, leaf: [u8; 32]) -> Result<[u8; 32]> {
        let capacity = 1u64 << self.height;
        require!((self.current_index as u64) < capacity, ShieldError::TreeFull);

        let zero_hashes = default_zero_hashes(self.height);
        let mut idx = self.current_index;
        let mut current = leaf;

        for level in 0..self.height {
            let lvl = level as usize;
            if idx % 2 == 0 {
                self.filled_subtrees[lvl] = current;
                current = hash_nodes(&current, &zero_hashes[lvl]);
            } else {
                let left = self.filled_subtrees[lvl];
                current = hash_nodes(&left, &current);
            }
            idx /= 2;
        }

        self.current_index += 1;
        self.push_root(current);
        Ok(current)
    }

    pub fn latest_root(&self) -> [u8; 32] {
        *self.cached_roots.last().unwrap_or(&self.filled_subtrees[(self.height - 1) as usize])
    }

    pub fn contains_root(&self, root: &[u8; 32]) -> bool {
        self.cached_roots.iter().any(|r| r == root)
    }

    fn push_root(&mut self, root: [u8; 32]) {
        if self.cached_roots.len() >= MAX_ROOT_HISTORY {
            self.cached_roots.remove(0);
        }
        self.cached_roots.push(root);
    }
}

pub fn default_zero_hashes(height: u8) -> Vec<[u8; 32]> {
    let mut zeros = Vec::with_capacity(height as usize);
    let mut current = [0u8; 32];
    for _ in 0..height {
        zeros.push(current);
        current = hash_nodes(&current, &current);
    }
    zeros
}
