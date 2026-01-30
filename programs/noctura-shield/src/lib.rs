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

#[derive(Accounts)
]
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
