#![allow(unexpected_cfgs)]
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

pub mod errors;
pub mod events;
pub mod merkle;
pub mod state;
pub mod utils;
pub mod verifier;

use errors::*;
use events::*;
use state::*;
use utils::*;
use verifier::*;

declare_id!("3KN2qrmEtPyk9WGu9jJSzLerxU8AUXAy8Dp6bqw5APDz");

const GLOBAL_STATE_SEED: &[u8] = b"global-state";
const TREE_SEED: &[u8] = b"merkle-tree";
const NULLIFIER_SEED: &[u8] = b"nullifiers";
const VERIFIER_SEED: &[u8] = b"verifier";
const WITHDRAW_VERIFIER_SEED: &[u8] = b"withdraw-verifier";
const TRANSFER_VERIFIER_SEED: &[u8] = b"transfer-verifier";
const PARTIAL_WITHDRAW_VERIFIER_SEED: &[u8] = b"partial-withdraw-verifier";
const VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority";
const LEGACY_VAULT_AUTHORITY_SEED: &[u8] = b"vault-authority"; // For vaults without mint suffix
const VAULT_TOKEN_SEED: &[u8] = b"vault-token";
const SOL_VAULT_SEED: &[u8] = b"sol-vault";

#[program]
pub mod noctura_shield {
    use super::*;

    pub fn initialize(
        ctx: Context<Initialize>,
        tree_height: u8,
        fee_collector: Pubkey,
        shield_fee_bps: u16,
        priority_fee_bps: u16,
    ) -> Result<()> {
        require!(tree_height <= MAX_TREE_HEIGHT, ShieldError::CapacityExceeded);

        let global = &mut ctx.accounts.global_state;
        global.admin = ctx.accounts.admin.key();
        global.fee_collector = fee_collector;
        global.shield_fee_bps = shield_fee_bps;
        global.priority_fee_bps = priority_fee_bps.max(shield_fee_bps);
        global.tree = ctx.accounts.merkle_tree.key();
        global.nullifier_set = ctx.accounts.nullifier_set.key();
        global.verifier = ctx.accounts.verifier.key();
        global.bump = ctx.bumps.global_state;

        ctx.accounts.merkle_tree.initialize(tree_height)?;
        ctx.accounts.nullifier_set.nullifiers = Vec::new();
        ctx.accounts.verifier.verifying_key = Vec::new();

        Ok(())
    }

    pub fn set_verifier(ctx: Context<SetVerifier>, verifying_key: Vec<u8>) -> Result<()> {
        require!(ctx.accounts.admin.key() == ctx.accounts.global_state.admin, ShieldError::Unauthorized);
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.verifier.verifying_key = verifying_key;
        Ok(())
    }

    pub fn set_withdraw_verifier(ctx: Context<SetWithdrawVerifier>, verifying_key: Vec<u8>) -> Result<()> {
        require!(ctx.accounts.admin.key() == ctx.accounts.global_state.admin, ShieldError::Unauthorized);
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.withdraw_verifier.verifying_key = verifying_key;
        Ok(())
    }

    pub fn set_transfer_verifier(ctx: Context<SetTransferVerifier>, verifying_key: Vec<u8>) -> Result<()> {
        require!(ctx.accounts.admin.key() == ctx.accounts.global_state.admin, ShieldError::Unauthorized);
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.transfer_verifier.verifying_key = verifying_key;
        Ok(())
    }

    pub fn set_partial_withdraw_verifier(ctx: Context<SetPartialWithdrawVerifier>, verifying_key: Vec<u8>) -> Result<()> {
        require!(ctx.accounts.admin.key() == ctx.accounts.global_state.admin, ShieldError::Unauthorized);
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.partial_withdraw_verifier.verifying_key = verifying_key;
        Ok(())
    }

    pub fn set_swap_verifier(ctx: Context<SetSwapVerifier>, verifying_key: Vec<u8>) -> Result<()> {
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.swap_verifier.verifying_key = verifying_key;
        msg!("Swap verifier set");
        Ok(())
    }

    /// Initialize swap verifier for chunked upload (use when key is too large for single tx)
    pub fn init_swap_verifier_chunked(ctx: Context<InitSwapVerifierChunked>) -> Result<()> {
        ctx.accounts.swap_verifier.verifying_key = Vec::new();
        msg!("Swap verifier initialized for chunked upload");
        Ok(())
    }

    /// Append chunk to swap verifier
    pub fn append_swap_verifier_chunk(ctx: Context<AppendSwapVerifierChunk>, chunk: Vec<u8>) -> Result<()> {
        let chunk_len = chunk.len();
        ctx.accounts.swap_verifier.verifying_key.extend(chunk);
        msg!("Appended {} bytes to swap verifier, total: {}", chunk_len, ctx.accounts.swap_verifier.verifying_key.len());
        Ok(())
    }

    /// Finalize swap verifier (validate the complete key)
    pub fn finalize_swap_verifier(ctx: Context<FinalizeSwapVerifier>) -> Result<()> {
        validate_verifier_key_blob(&ctx.accounts.swap_verifier.verifying_key)?;
        msg!("Swap verifier finalized with {} bytes", ctx.accounts.swap_verifier.verifying_key.len());
        Ok(())
    }

    /// Set swap V2 verifier (for partial swaps with change)
    pub fn set_swap_v2_verifier(ctx: Context<SetSwapV2Verifier>, verifying_key: Vec<u8>) -> Result<()> {
        validate_verifier_key_blob(&verifying_key)?;
        ctx.accounts.swap_v2_verifier.verifying_key = verifying_key;
        msg!("Swap V2 verifier set");
        Ok(())
    }

    /// Initialize swap V2 verifier for chunked upload
    pub fn init_swap_v2_verifier_chunked(ctx: Context<InitSwapV2VerifierChunked>) -> Result<()> {
        ctx.accounts.swap_v2_verifier.verifying_key = Vec::new();
        msg!("Swap V2 verifier initialized for chunked upload");
        Ok(())
    }

    /// Append chunk to swap V2 verifier
    pub fn append_swap_v2_verifier_chunk(ctx: Context<AppendSwapV2VerifierChunk>, chunk: Vec<u8>) -> Result<()> {
        let chunk_len = chunk.len();
        ctx.accounts.swap_v2_verifier.verifying_key.extend(chunk);
        msg!("Appended {} bytes to swap V2 verifier, total: {}", chunk_len, ctx.accounts.swap_v2_verifier.verifying_key.len());
        Ok(())
    }

    /// Finalize swap V2 verifier
    pub fn finalize_swap_v2_verifier(ctx: Context<FinalizeSwapV2Verifier>) -> Result<()> {
        validate_verifier_key_blob(&ctx.accounts.swap_v2_verifier.verifying_key)?;
        msg!("Swap V2 verifier finalized with {} bytes", ctx.accounts.swap_v2_verifier.verifying_key.len());
        Ok(())
    }

    /// Initialize consolidate verifier for chunked upload
    pub fn init_consolidate_verifier_chunked(ctx: Context<InitConsolidateVerifierChunked>) -> Result<()> {
        ctx.accounts.consolidate_verifier.verifying_key = Vec::new();
        msg!("Consolidate verifier initialized for chunked upload");
        Ok(())
    }

    /// Append chunk to consolidate verifier
    pub fn append_consolidate_verifier_chunk(ctx: Context<AppendConsolidateVerifierChunk>, chunk: Vec<u8>) -> Result<()> {
        let chunk_len = chunk.len();
        ctx.accounts.consolidate_verifier.verifying_key.extend(chunk);
        msg!("Appended {} bytes to consolidate verifier, total: {}", chunk_len, ctx.accounts.consolidate_verifier.verifying_key.len());
        Ok(())
    }

    /// Finalize consolidate verifier
    pub fn finalize_consolidate_verifier(ctx: Context<FinalizeConsolidateVerifier>) -> Result<()> {
        validate_verifier_key_blob(&ctx.accounts.consolidate_verifier.verifying_key)?;
        msg!("Consolidate verifier finalized with {} bytes", ctx.accounts.consolidate_verifier.verifying_key.len());
        Ok(())
    }

    /// Shielded consolidation: merge multiple notes into one using consolidate circuit
    pub fn shielded_consolidate(
        ctx: Context<ShieldedConsolidate>,
        input_nullifiers: Vec<[u8; 32]>,
        output_commitment: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(!input_nullifiers.is_empty(), ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.consolidate_verifier, &proof, &public_inputs)?;

        let nullifier_count = input_nullifiers.len();
        for nullifier in input_nullifiers {
            track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;
            emit!(NullifierConsumed { nullifier });
        }

        let _root = ctx.accounts.merkle_tree.append_leaf(output_commitment)?;
        msg!("Consolidated {} notes into 1", nullifier_count);

        Ok(())
    }

    /// Admin function to update shield fee (in basis points)
    pub fn set_fee(ctx: Context<SetFee>, shield_fee_bps: u16, priority_fee_bps: u16) -> Result<()> {
        let global = &mut ctx.accounts.global_state;
        global.shield_fee_bps = shield_fee_bps;
        global.priority_fee_bps = priority_fee_bps.max(shield_fee_bps);
        Ok(())
    }

    pub fn set_fee_collector(ctx: Context<SetFeeCollector>, new_fee_collector: Pubkey) -> Result<()> {
        let global = &mut ctx.accounts.global_state;
        require!(ctx.accounts.admin.key() == global.admin, ShieldError::Unauthorized);
        global.fee_collector = new_fee_collector;
        Ok(())
    }

    /// Admin function to reset the nullifier set (for devnet testing only)
    /// WARNING: This allows double-spending of previously spent notes!
    pub fn reset_nullifiers(ctx: Context<ResetNullifiers>) -> Result<()> {
        let global = &ctx.accounts.global_state;
        require!(ctx.accounts.admin.key() == global.admin, ShieldError::Unauthorized);
        ctx.accounts.nullifier_set.nullifiers = Vec::new();
        msg!("Nullifier set reset by admin");
        Ok(())
    }

    /// Admin function to withdraw NOC from vault (for devnet corrections)
    pub fn admin_withdraw_vault_noc(
        ctx: Context<AdminWithdrawVaultNoc>,
        amount: u64,
    ) -> Result<()> {
        let vault_bump = ctx.bumps.vault_authority;
        let mint_key = ctx.accounts.mint.key();
        let seeds = &[VAULT_AUTHORITY_SEED, mint_key.as_ref(), &[vault_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_ctx, signer),
            amount,
        )?;
        msg!("Admin withdrew {} tokens from vault", amount);
        Ok(())
    }

    /// Admin withdraw from legacy vault (vault-authority PDA without mint)
    pub fn admin_withdraw_legacy_vault(
        ctx: Context<AdminWithdrawLegacyVault>,
        amount: u64,
    ) -> Result<()> {
        let vault_bump = ctx.bumps.legacy_vault_authority;
        // Legacy vault uses just "vault-authority" seed without mint
        let seeds = &[LEGACY_VAULT_AUTHORITY_SEED, &[vault_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.destination.to_account_info(),
            authority: ctx.accounts.legacy_vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_ctx, signer),
            amount,
        )?;
        msg!("Admin withdrew {} tokens from legacy vault", amount);
        Ok(())
    }

    pub fn transparent_deposit(
        ctx: Context<TransparentDeposit>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
        priority_lane: bool,
    ) -> Result<()> {
        require!(amount > 0, ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.verifier, &proof, &public_inputs)?;

        let fee_bps = if priority_lane {
            ctx.accounts.global_state.priority_fee_bps
        } else {
            ctx.accounts.global_state.shield_fee_bps
        };
        let fee_amount = amount.saturating_mul(fee_bps as u64) / 10_000;

        // Move tokens into the vault.
        let transfer_to_vault = Transfer {
            from: ctx.accounts.user_token_account.to_account_info(),
            to: ctx.accounts.vault_token_account.to_account_info(),
            authority: ctx.accounts.payer.to_account_info(),
        };
        token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_to_vault), amount)?;

        // Collect protocol fee.
        if fee_amount > 0 {
            let transfer_fee = Transfer {
                from: ctx.accounts.user_token_account.to_account_info(),
                to: ctx.accounts.fee_collector_token_account.to_account_info(),
                authority: ctx.accounts.payer.to_account_info(),
            };
            token::transfer(CpiContext::new(ctx.accounts.token_program.to_account_info(), transfer_fee), fee_amount)?;
        }

        let new_root = ctx.accounts.merkle_tree.append_leaf(commitment)?;
        emit!(CommitmentInserted {
            commitment,
            nullifier,
            new_root,
            is_priority: priority_lane,
        });

        Ok(())
    }

    /// Transparent deposit for native SOL: deposit from payer to vault PDA
    /// This adds the commitment to the Merkle tree, enabling later withdrawal
    pub fn transparent_deposit_sol(
        ctx: Context<TransparentDepositSol>,
        commitment: [u8; 32],
        nullifier: [u8; 32],
        amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(amount > 0, ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.verifier, &proof, &public_inputs)?;

        // Transfer native SOL from payer to vault
        anchor_lang::solana_program::program::invoke(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.payer.key(),
                &ctx.accounts.sol_vault.key(),
                amount,
            ),
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // Add commitment to Merkle tree
        let new_root = ctx.accounts.merkle_tree.append_leaf(commitment)?;
        emit!(CommitmentInserted {
            commitment,
            nullifier,
            new_root,
            is_priority: false,
        });

        Ok(())
    }

    pub fn shielded_transfer(
        ctx: Context<ShieldedTransfer>,
        input_nullifiers: Vec<[u8; 32]>,
        output_commitments: Vec<[u8; 32]>,
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(!input_nullifiers.is_empty(), ShieldError::InvalidAmount);
        require!(!output_commitments.is_empty(), ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.transfer_verifier, &proof, &public_inputs)?;

        for nullifier in input_nullifiers {
            track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;
            emit!(NullifierConsumed { nullifier });
        }

        for commitment in output_commitments {
            let _root = ctx.accounts.merkle_tree.append_leaf(commitment)?;
        }

        Ok(())
    }

    pub fn transparent_withdraw(
        ctx: Context<TransparentWithdraw>,
        amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
        nullifier: [u8; 32],
    ) -> Result<()> {
        require!(amount > 0, ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.withdraw_verifier, &proof, &public_inputs)?;
        track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;

        let vault_bump = ctx.bumps.vault_authority;
        let mint_key = ctx.accounts.mint.key();
        let seeds = &[VAULT_AUTHORITY_SEED, mint_key.as_ref(), &[vault_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.receiver_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_ctx, signer),
            amount,
        )?;
        emit!(NullifierConsumed { nullifier });
        Ok(())
    }

    /// Transparent withdraw for native SOL: withdraw from vault PDA to recipient
    pub fn transparent_withdraw_sol(
        ctx: Context<TransparentWithdrawSol>,
        amount: u64,
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
        nullifier: [u8; 32],
    ) -> Result<()> {
        verify_groth16(&ctx.accounts.withdraw_verifier, &proof, &public_inputs)?;
        track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;

        let sol_vault_bump = ctx.bumps.sol_vault;
        let seeds = &[SOL_VAULT_SEED, &[sol_vault_bump]];
        let signer = &[&seeds[..]];

        // Transfer native SOL from vault to recipient using invoke_signed
        anchor_lang::solana_program::program::invoke_signed(
            &anchor_lang::solana_program::system_instruction::transfer(
                &ctx.accounts.sol_vault.key(),
                &ctx.accounts.recipient.key(),
                amount,
            ),
            &[
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.recipient.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            signer,
        )?;
        emit!(NullifierConsumed { nullifier });
        Ok(())
    }

    /// Partial withdraw: withdraw some amount to transparent wallet, keep change shielded
    pub fn partial_withdraw(
        ctx: Context<PartialWithdraw>,
        withdraw_amount: u64,
        change_commitment: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
        nullifier: [u8; 32],
    ) -> Result<()> {
        require!(withdraw_amount > 0, ShieldError::InvalidAmount);
        verify_groth16(&ctx.accounts.partial_withdraw_verifier, &proof, &public_inputs)?;
        track_nullifier(&mut ctx.accounts.nullifier_set, nullifier)?;

        // Transfer withdraw_amount to recipient
        let vault_bump = ctx.bumps.vault_authority;
        let mint_key = ctx.accounts.mint.key();
        let seeds = &[VAULT_AUTHORITY_SEED, mint_key.as_ref(), &[vault_bump]];
        let signer = &[&seeds[..]];

        let transfer_ctx = Transfer {
            from: ctx.accounts.vault_token_account.to_account_info(),
            to: ctx.accounts.receiver_token_account.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(ctx.accounts.token_program.to_account_info(), transfer_ctx, signer),
            withdraw_amount,
        )?;

        // Add change commitment to merkle tree
        let _new_root = ctx.accounts.merkle_tree.append_leaf(change_commitment)?;

        emit!(NullifierConsumed { nullifier });
        Ok(())
    }

    /// Debug instruction to test alt_bn128 syscall directly
    pub fn test_scalar_mul(_ctx: Context<TestScalarMul>, input: Vec<u8>) -> Result<()> {
        use solana_program::alt_bn128::prelude::alt_bn128_multiplication;
        use solana_program::log::sol_log_data;

        sol_log_data(&[b"test.input.len", &(input.len() as u64).to_le_bytes()]);
        sol_log_data(&[b"test.input", &input]);

        match alt_bn128_multiplication(&input) {
            Ok(result) => {
                sol_log_data(&[b"test.success", &result]);
                Ok(())
            }
            Err(e) => {
                let err_code: u64 = e.into();
                sol_log_data(&[b"test.error", &err_code.to_le_bytes()]);
                Err(error!(ShieldError::InvalidProof))
            }
        }
    }

    /// DEVNET ONLY: Emergency reset nullifiers without admin check
    /// This allows resetting the nullifier set when admin keypair is lost
    pub fn emergency_reset_nullifiers(ctx: Context<EmergencyResetNullifiers>) -> Result<()> {
        msg!("EMERGENCY: Resetting nullifier set (devnet only)");
        ctx.accounts.nullifier_set.nullifiers.clear();
        msg!("Nullifier set cleared, new count: {}", ctx.accounts.nullifier_set.nullifiers.len());
        Ok(())
    }

    /// Admin function to initialize a vault token account for a specific mint
    /// This creates the vault PDA without requiring a deposit
    pub fn init_token_vault(ctx: Context<InitTokenVault>) -> Result<()> {
        // Vault is created by the init_if_needed constraint
        msg!("Vault token account initialized for mint: {}", ctx.accounts.mint.key());
        msg!("Vault address: {}", ctx.accounts.vault_token_account.key());
        Ok(())
    }

    // ============================================
    // SHIELDED LIQUIDITY POOL INSTRUCTIONS
    // ============================================

    /// Initialize the shielded liquidity pool
    pub fn initialize_shielded_pool(
        ctx: Context<InitializeShieldedPool>,
        swap_fee_bps: u16,
    ) -> Result<()> {
        require!(swap_fee_bps <= 1000, ShieldError::InvalidAmount); // Max 10% fee

        let pool = &mut ctx.accounts.shielded_pool;
        pool.admin = ctx.accounts.admin.key();
        pool.sol_reserve = 0;
        pool.noc_reserve = 0;
        pool.lp_total_supply = 0;
        pool.swap_fee_bps = swap_fee_bps;
        pool.bump = ctx.bumps.shielded_pool;
        pool.enabled = true;

        msg!("Shielded pool initialized with {}bps fee", swap_fee_bps);
        Ok(())
    }

    /// Add initial liquidity to the shielded pool (admin only, from vault reserves)
    /// This seeds the pool using existing vault deposits
    pub fn seed_shielded_pool(
        ctx: Context<SeedShieldedPool>,
        sol_amount: u64,
        noc_amount: u64,
    ) -> Result<()> {
        require!(sol_amount > 0 && noc_amount > 0, ShieldError::InvalidAmount);

        let pool = &mut ctx.accounts.shielded_pool;
        require!(pool.enabled, ShieldError::InvalidAmount);
        require!(pool.sol_reserve == 0 && pool.noc_reserve == 0, ShieldError::InvalidAmount);

        // Update pool reserves (tokens are already in the vaults)
        pool.sol_reserve = sol_amount;
        pool.noc_reserve = noc_amount;
        // LP tokens = sqrt(sol * noc)
        pool.lp_total_supply = isqrt((sol_amount as u128) * (noc_amount as u128)) as u64;

        msg!("Shielded pool seeded: {} SOL, {} NOC, {} LP tokens", 
            sol_amount, noc_amount, pool.lp_total_supply);
        Ok(())
    }

    /// Add more liquidity to the shielded pool (admin only)
    /// Simply increases the reserves without requiring the initial zero check
    pub fn add_pool_liquidity(
        ctx: Context<AddPoolLiquidity>,
        sol_amount: u64,
        noc_amount: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.shielded_pool;
        require!(pool.enabled, ShieldError::InvalidAmount);

        if sol_amount > 0 {
            pool.sol_reserve = pool.sol_reserve.checked_add(sol_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
        }
        if noc_amount > 0 {
            pool.noc_reserve = pool.noc_reserve.checked_add(noc_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
        }

        // Recalculate LP supply based on new reserves
        let new_lp = isqrt((pool.sol_reserve as u128) * (pool.noc_reserve as u128)) as u64;
        pool.lp_total_supply = new_lp;

        msg!("Added liquidity: {} SOL, {} NOC. New reserves: {} SOL, {} NOC", 
            sol_amount, noc_amount, pool.sol_reserve, pool.noc_reserve);
        Ok(())
    }

    /// Admin function to directly set pool reserves (for corrections)
    pub fn set_pool_reserves(
        ctx: Context<SetPoolReserves>,
        sol_reserve: u64,
        noc_reserve: u64,
    ) -> Result<()> {
        let pool = &mut ctx.accounts.shielded_pool;
        
        pool.sol_reserve = sol_reserve;
        pool.noc_reserve = noc_reserve;
        pool.lp_total_supply = isqrt((sol_reserve as u128) * (noc_reserve as u128)) as u64;
        pool.enabled = true; // Always enable when reserves are set

        msg!("Pool reserves set: {} SOL, {} NOC (enabled)", sol_reserve, noc_reserve);
        Ok(())
    }

    /// Execute a shielded swap within the pool
    /// User provides ZK proof of valid input note, receives output note
    /// No tokens leave the shielded system!
    pub fn shielded_pool_swap(
        ctx: Context<ShieldedPoolSwap>,
        input_amount: u64,
        min_output_amount: u64,
        input_is_sol: bool, // true = SOL->NOC, false = NOC->SOL
        input_nullifier: [u8; 32],
        output_commitment: [u8; 32],
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(input_amount > 0, ShieldError::InvalidAmount);

        // Verify ZK proof
        verify_groth16(&ctx.accounts.swap_verifier, &proof, &public_inputs)?;

        // Track nullifier (prevents double-spend)
        track_nullifier(&mut ctx.accounts.nullifier_set, input_nullifier)?;

        let pool = &mut ctx.accounts.shielded_pool;
        require!(pool.enabled, ShieldError::InvalidAmount);

        // Calculate output using AMM formula
        let output_amount = pool.calculate_output(input_amount, input_is_sol)
            .ok_or(error!(ShieldError::InvalidAmount))?;

        // Slippage check
        require!(output_amount >= min_output_amount, ShieldError::InvalidAmount);

        // Update pool reserves
        if input_is_sol {
            pool.sol_reserve = pool.sol_reserve.checked_add(input_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.noc_reserve = pool.noc_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        } else {
            pool.noc_reserve = pool.noc_reserve.checked_add(input_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.sol_reserve = pool.sol_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        }

        // Add output commitment to Merkle tree
        let _new_root = ctx.accounts.merkle_tree.append_leaf(output_commitment)?;

        emit!(ShieldedSwapExecuted {
            input_nullifier,
            output_commitment,
            is_noc_to_sol: !input_is_sol,
            input_amount,
            output_amount,
        });

        emit!(NullifierConsumed { nullifier: input_nullifier });

        msg!("Shielded swap: {} {} -> {} {}", 
            input_amount, 
            if input_is_sol { "SOL" } else { "NOC" },
            output_amount,
            if input_is_sol { "NOC" } else { "SOL" }
        );

        Ok(())
    }

    /// Execute a shielded swap V2 - supports partial swaps with change
    /// User swaps some amount, receives output token + change in same token
    /// No tokens leave the shielded system!
    pub fn shielded_pool_swap_v2(
        ctx: Context<ShieldedPoolSwapV2>,
        swap_amount: u64,          // Amount being swapped (not full note amount)
        min_output_amount: u64,
        input_is_sol: bool,        // true = SOL->NOC, false = NOC->SOL
        input_nullifier: [u8; 32],
        output_commitment: [u8; 32],  // Swapped token commitment
        change_commitment: [u8; 32],  // Change commitment (same token as input)
        proof: Vec<u8>,
        public_inputs: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(swap_amount > 0, ShieldError::InvalidAmount);

        // Verify ZK proof (swap_v2 circuit)
        verify_groth16(&ctx.accounts.swap_v2_verifier, &proof, &public_inputs)?;

        // Track nullifier (prevents double-spend)
        track_nullifier(&mut ctx.accounts.nullifier_set, input_nullifier)?;

        let pool = &mut ctx.accounts.shielded_pool;
        require!(pool.enabled, ShieldError::InvalidAmount);

        // Calculate output using AMM formula (based on swap_amount, not full note)
        let output_amount = pool.calculate_output(swap_amount, input_is_sol)
            .ok_or(error!(ShieldError::InvalidAmount))?;

        // Slippage check
        require!(output_amount >= min_output_amount, ShieldError::InvalidAmount);

        // Update pool reserves (only swap_amount affects the pool)
        if input_is_sol {
            pool.sol_reserve = pool.sol_reserve.checked_add(swap_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.noc_reserve = pool.noc_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        } else {
            pool.noc_reserve = pool.noc_reserve.checked_add(swap_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.sol_reserve = pool.sol_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        }

        // Add BOTH output commitments to Merkle tree
        // First: swapped token commitment
        let _root1 = ctx.accounts.merkle_tree.append_leaf(output_commitment)?;
        // Second: change commitment (same token as input)
        let _root2 = ctx.accounts.merkle_tree.append_leaf(change_commitment)?;

        emit!(ShieldedSwapV2Executed {
            input_nullifier,
            output_commitment,
            change_commitment,
            is_noc_to_sol: !input_is_sol,
            swap_amount,
            output_amount,
        });

        emit!(NullifierConsumed { nullifier: input_nullifier });

        msg!("Shielded swap V2: {} {} -> {} {} + change", 
            swap_amount, 
            if input_is_sol { "SOL" } else { "NOC" },
            output_amount,
            if input_is_sol { "NOC" } else { "SOL" }
        );

        Ok(())
    }

    /// Get pool reserves (view function)
    pub fn get_pool_reserves(ctx: Context<GetPoolReserves>) -> Result<()> {
        let pool = &ctx.accounts.shielded_pool;
        msg!("Pool reserves: {} SOL, {} NOC, fee: {}bps", 
            pool.sol_reserve, pool.noc_reserve, pool.swap_fee_bps);
        Ok(())
    }

    /// Execute a transparent swap using the on-chain pool
    /// Tokens are transferred on-chain, no ZK proofs needed
    pub fn transparent_pool_swap(
        ctx: Context<TransparentPoolSwap>,
        input_amount: u64,
        min_output_amount: u64,
        input_is_sol: bool, // true = SOL->NOC, false = NOC->SOL
    ) -> Result<()> {
        require!(input_amount > 0, ShieldError::InvalidAmount);

        let pool = &mut ctx.accounts.shielded_pool;
        require!(pool.enabled, ShieldError::InvalidAmount);

        // Calculate output using AMM formula (same as shielded)
        let output_amount = pool.calculate_output(input_amount, input_is_sol)
            .ok_or(error!(ShieldError::InvalidAmount))?;

        // Slippage check
        require!(output_amount >= min_output_amount, ShieldError::InvalidAmount);

        if input_is_sol {
            // User sends SOL, receives NOC
            // Transfer SOL from user to sol_vault
            let cpi_ctx = CpiContext::new(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::Transfer {
                    from: ctx.accounts.user.to_account_info(),
                    to: ctx.accounts.sol_vault.to_account_info(),
                },
            );
            anchor_lang::system_program::transfer(cpi_ctx, input_amount)?;

            // Transfer NOC from vault to user
            let mint_key = ctx.accounts.noc_mint.key();
            let vault_bump = ctx.bumps.vault_authority;
            let seeds = &[VAULT_AUTHORITY_SEED, mint_key.as_ref(), &[vault_bump]];
            let signer_seeds = &[&seeds[..]];

            let transfer_ctx = CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.vault_token_account.to_account_info(),
                    to: ctx.accounts.user_noc_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                },
                signer_seeds,
            );
            anchor_spl::token::transfer(transfer_ctx, output_amount)?;

            // Update reserves
            pool.sol_reserve = pool.sol_reserve.checked_add(input_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.noc_reserve = pool.noc_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        } else {
            // User sends NOC, receives SOL
            // Transfer NOC from user to vault
            let transfer_ctx = CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                anchor_spl::token::Transfer {
                    from: ctx.accounts.user_noc_account.to_account_info(),
                    to: ctx.accounts.vault_token_account.to_account_info(),
                    authority: ctx.accounts.user.to_account_info(),
                },
            );
            anchor_spl::token::transfer(transfer_ctx, input_amount)?;

            // Transfer SOL from sol_vault to user using invoke_signed
            let sol_vault_bump = ctx.bumps.sol_vault;
            let seeds = &[SOL_VAULT_SEED, &[sol_vault_bump]];
            let signer = &[&seeds[..]];

            anchor_lang::solana_program::program::invoke_signed(
                &anchor_lang::solana_program::system_instruction::transfer(
                    &ctx.accounts.sol_vault.key(),
                    &ctx.accounts.user.key(),
                    output_amount,
                ),
                &[
                    ctx.accounts.sol_vault.to_account_info(),
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer,
            )?;

            // Update reserves
            pool.noc_reserve = pool.noc_reserve.checked_add(input_amount)
                .ok_or(error!(ShieldError::CapacityExceeded))?;
            pool.sol_reserve = pool.sol_reserve.checked_sub(output_amount)
                .ok_or(error!(ShieldError::InvalidAmount))?;
        }

        emit!(TransparentSwapExecuted {
            user: ctx.accounts.user.key(),
            is_sol_to_noc: input_is_sol,
            input_amount,
            output_amount,
        });

        msg!("Transparent swap: {} {} -> {} {}", 
            input_amount, 
            if input_is_sol { "SOL" } else { "NOC" },
            output_amount,
            if input_is_sol { "NOC" } else { "SOL" }
        );

        Ok(())
    }
}

#[derive(Accounts)]
pub struct TestScalarMul {}

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        init,
        payer = admin,
        space = GlobalState::LEN + 8,
        seeds = [GLOBAL_STATE_SEED],
        bump
    )]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init,
        payer = admin,
        space = MerkleTreeAccount::space(MAX_TREE_HEIGHT),
        seeds = [TREE_SEED],
        bump
    )]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(
        init,
        payer = admin,
        space = NullifierSetAccount::space(),
        seeds = [NULLIFIER_SEED],
        bump
    )]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(
        init,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [VERIFIER_SEED],
        bump
    )]
    pub verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [VERIFIER_SEED], bump)]
    pub verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct SetFee<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct SetFeeCollector<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut, seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
}

#[derive(Accounts)]
pub struct ResetNullifiers<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
}

/// DEVNET ONLY: Emergency reset without admin check
#[derive(Accounts)]
pub struct EmergencyResetNullifiers<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
}

/// Admin withdraw NOC from vault
#[derive(Accounts)]
pub struct AdminWithdrawVaultNoc<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump, has_one = admin)]
    pub global_state: Account<'info, GlobalState>,
    pub mint: Account<'info, Mint>,
    /// CHECK: PDA authority for the vault
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

/// Admin withdraw NOC from legacy vault (uses vault-authority PDA without mint suffix)
/// DEVNET ONLY: No admin check for migration purposes
#[derive(Accounts)]
pub struct AdminWithdrawLegacyVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    pub mint: Account<'info, Mint>,
    /// CHECK: Legacy PDA authority (vault-authority without mint)
    #[account(
        seeds = [LEGACY_VAULT_AUTHORITY_SEED],
        bump
    )]
    pub legacy_vault_authority: UncheckedAccount<'info>,
    #[account(
        mut,
        token::mint = mint,
        token::authority = legacy_vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub destination: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransparentDeposit<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [VERIFIER_SEED], bump)]
    pub verifier: Account<'info, VerifierAccount>,
    pub mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_token_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = payer,
        seeds = [VAULT_TOKEN_SEED, mint.key().as_ref()],
            bump,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
        #[account(
            mut,
            constraint = fee_collector_token_account.owner == global_state.fee_collector
        )]
        pub fee_collector_token_account: Account<'info, TokenAccount>,
    /// CHECK: Derived PDA, used as token authority signer
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
            bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Accounts for transparent SOL deposit (native SOL, no token program)
#[derive(Accounts)]
pub struct TransparentDepositSol<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [VERIFIER_SEED], bump)]
    pub verifier: Account<'info, VerifierAccount>,
    /// CHECK: SOL vault PDA, destination for native SOL
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ShieldedTransfer<'info> {
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [TRANSFER_VERIFIER_SEED], bump)]
    pub transfer_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct SetTransferVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [TRANSFER_VERIFIER_SEED],
        bump
    )]
    pub transfer_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetWithdrawVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [WITHDRAW_VERIFIER_SEED],
        bump
    )]
    pub withdraw_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetPartialWithdrawVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [PARTIAL_WITHDRAW_VERIFIER_SEED],
        bump
    )]
    pub partial_withdraw_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct TransparentWithdraw<'info> {
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [WITHDRAW_VERIFIER_SEED], bump)]
    pub withdraw_verifier: Account<'info, VerifierAccount>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_TOKEN_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub receiver_token_account: Account<'info, TokenAccount>,
    /// CHECK: Derived PDA
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct TransparentWithdrawSol<'info> {
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [WITHDRAW_VERIFIER_SEED], bump)]
    pub withdraw_verifier: Account<'info, VerifierAccount>,
    /// CHECK: SOL vault PDA, source of native SOL
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: Recipient wallet address
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct PartialWithdraw<'info> {
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [PARTIAL_WITHDRAW_VERIFIER_SEED], bump)]
    pub partial_withdraw_verifier: Account<'info, VerifierAccount>,
    pub mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_TOKEN_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub receiver_token_account: Account<'info, TokenAccount>,
    /// CHECK: Derived PDA
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

// ============================================
// SHIELDED POOL ACCOUNT STRUCTURES
// ============================================

const SHIELDED_POOL_SEED: &[u8] = b"shielded-pool";
const SWAP_VERIFIER_SEED: &[u8] = b"swap-verifier";
const SWAP_V2_VERIFIER_SEED: &[u8] = b"swap-v2-verifier";
const CONSOLIDATE_VERIFIER_SEED: &[u8] = b"consolidate-verifier";

#[derive(Accounts)]
pub struct InitializeShieldedPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init,
        payer = admin,
        space = ShieldedPool::LEN + 8,
        seeds = [SHIELDED_POOL_SEED],
        bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SeedShieldedPool<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump,
        constraint = shielded_pool.admin == admin.key()
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
}

#[derive(Accounts)]
pub struct AddPoolLiquidity<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
}

#[derive(Accounts)]
pub struct SetPoolReserves<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
}

#[derive(Accounts)]
pub struct ShieldedPoolSwap<'info> {
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [SWAP_VERIFIER_SEED], bump)]
    pub swap_verifier: Account<'info, VerifierAccount>,
}

/// Accounts for swap V2 - supports partial swaps with change
#[derive(Accounts)]
pub struct ShieldedPoolSwapV2<'info> {
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
    #[account(mut, seeds = [TREE_SEED], bump)]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(mut, seeds = [NULLIFIER_SEED], bump)]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(seeds = [SWAP_V2_VERIFIER_SEED], bump)]
    pub swap_v2_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct GetPoolReserves<'info> {
    #[account(seeds = [SHIELDED_POOL_SEED], bump = shielded_pool.bump)]
    pub shielded_pool: Account<'info, ShieldedPool>,
}

/// Accounts for transparent (non-shielded) pool swap
#[derive(Accounts)]
pub struct TransparentPoolSwap<'info> {
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [SHIELDED_POOL_SEED],
        bump = shielded_pool.bump
    )]
    pub shielded_pool: Account<'info, ShieldedPool>,
    /// CHECK: SOL vault PDA
    #[account(
        mut,
        seeds = [SOL_VAULT_SEED],
        bump,
    )]
    pub sol_vault: UncheckedAccount<'info>,
    pub noc_mint: Account<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_TOKEN_SEED, noc_mint.key().as_ref()],
        bump,
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: Vault authority PDA
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, noc_mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub user_noc_account: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

/// Accounts for admin vault initialization
#[derive(Accounts)]
pub struct InitTokenVault<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    pub mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = admin,
        seeds = [VAULT_TOKEN_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = vault_authority
    )]
    pub vault_token_account: Account<'info, TokenAccount>,
    /// CHECK: Derived PDA, used as token authority
    #[account(
        seeds = [VAULT_AUTHORITY_SEED, mint.key().as_ref()],
        bump,
    )]
    pub vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct SetSwapVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [SWAP_VERIFIER_SEED],
        bump
    )]
    pub swap_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitSwapVerifierChunked<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [SWAP_VERIFIER_SEED],
        bump
    )]
    pub swap_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendSwapVerifierChunk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [SWAP_VERIFIER_SEED],
        bump
    )]
    pub swap_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct FinalizeSwapVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        seeds = [SWAP_VERIFIER_SEED],
        bump
    )]
    pub swap_verifier: Account<'info, VerifierAccount>,
}

// ============================================
// SWAP V2 VERIFIER ACCOUNT STRUCTURES
// ============================================

#[derive(Accounts)]
pub struct SetSwapV2Verifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [SWAP_V2_VERIFIER_SEED],
        bump
    )]
    pub swap_v2_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitSwapV2VerifierChunked<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [SWAP_V2_VERIFIER_SEED],
        bump
    )]
    pub swap_v2_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendSwapV2VerifierChunk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [SWAP_V2_VERIFIER_SEED],
        bump
    )]
    pub swap_v2_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct FinalizeSwapV2Verifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        seeds = [SWAP_V2_VERIFIER_SEED],
        bump
    )]
    pub swap_v2_verifier: Account<'info, VerifierAccount>,
}

// ============================================
// CONSOLIDATE VERIFIER ACCOUNT STRUCTURES
// ============================================

#[derive(Accounts)]
pub struct InitConsolidateVerifierChunked<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        init_if_needed,
        payer = admin,
        space = VerifierAccount::space(),
        seeds = [CONSOLIDATE_VERIFIER_SEED],
        bump
    )]
    pub consolidate_verifier: Account<'info, VerifierAccount>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AppendConsolidateVerifierChunk<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        mut,
        seeds = [CONSOLIDATE_VERIFIER_SEED],
        bump
    )]
    pub consolidate_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct FinalizeConsolidateVerifier<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(seeds = [GLOBAL_STATE_SEED], bump = global_state.bump)]
    pub global_state: Account<'info, GlobalState>,
    #[account(
        seeds = [CONSOLIDATE_VERIFIER_SEED],
        bump
    )]
    pub consolidate_verifier: Account<'info, VerifierAccount>,
}

#[derive(Accounts)]
pub struct ShieldedConsolidate<'info> {
    #[account(
        mut,
        seeds = [TREE_SEED],
        bump
    )]
    pub merkle_tree: Account<'info, MerkleTreeAccount>,
    #[account(
        mut,
        seeds = [NULLIFIER_SEED],
        bump
    )]
    pub nullifier_set: Account<'info, NullifierSetAccount>,
    #[account(
        seeds = [CONSOLIDATE_VERIFIER_SEED],
        bump
    )]
    pub consolidate_verifier: Account<'info, VerifierAccount>,
}
