use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};
use crate::constants::{GLOBAL_CONFIG_SEED, POOL_AUTHORITY_SEED, POOL_STATE_SEED};
use crate::errors::ErrorCode;
use crate::math::{compute_swap_exact_input, compute_swap_exact_output};
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
pub struct Swap<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        seeds = [
            POOL_STATE_SEED,
            pool_state.token_mint_0.as_ref(),
            pool_state.token_mint_1.as_ref(),
            &pool_state.fee_tier.to_le_bytes()
        ],
        bump = pool_state.bump
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Pool authority PDA for CPI signing
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump = pool_state.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        address = pool_state.token_vault_0
    )]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(
        mut,
        address = pool_state.token_vault_1
    )]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn process_swap_exact_input(
    ctx: Context<Swap>,
    amount_in: u64,
    minimum_amount_out: u64,
    zero_for_one: bool,
) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ErrorCode::EmergencyPaused);
    require!(!ctx.accounts.pool_state.is_paused, ErrorCode::PoolPaused);

    let pool = &mut ctx.accounts.pool_state;
    let (reserve_in, reserve_out) = if zero_for_one {
        (pool.reserve_0, pool.reserve_1)
    } else {
        (pool.reserve_1, pool.reserve_0)
    };

    let k_before = (pool.reserve_0 as u128)
        .checked_mul(pool.reserve_1 as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let (amount_out, protocol_fee) = compute_swap_exact_input(
        amount_in,
        reserve_in,
        reserve_out,
        pool.fee_tier,
        ctx.accounts.config.protocol_fee_fraction,
    )?;

    require!(amount_out >= minimum_amount_out, ErrorCode::SlippageExceeded);

    let (vault_in, vault_out) = if zero_for_one {
        (
            ctx.accounts.token_vault_0.to_account_info(),
            ctx.accounts.token_vault_1.to_account_info(),
        )
    } else {
        (
            ctx.accounts.token_vault_1.to_account_info(),
            ctx.accounts.token_vault_0.to_account_info(),
        )
    };

    // 1. Transfer input tokens from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_source.to_account_info(),
                to: vault_in,
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;

    // 2. Transfer output tokens from vault to user
    let pool_key = pool.key();
    let authority_seeds: &[&[u8]] = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault_out,
                to: ctx.accounts.user_destination.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount_out,
    )?;

    // 3. Update reserves (LP reserve excludes protocol fees to prevent vault desync)
    let reserve_in_increase = amount_in
        .checked_sub(protocol_fee)
        .ok_or(ErrorCode::MathOverflow)?;

    if zero_for_one {
        pool.reserve_0 = pool.reserve_0.checked_add(reserve_in_increase).ok_or(ErrorCode::MathOverflow)?;
        pool.reserve_1 = pool.reserve_1.checked_sub(amount_out).ok_or(ErrorCode::MathOverflow)?;
        if protocol_fee > 0 {
            pool.protocol_fees_0 = pool.protocol_fees_0.checked_add(protocol_fee).ok_or(ErrorCode::MathOverflow)?;
        }
    } else {
        pool.reserve_1 = pool.reserve_1.checked_add(reserve_in_increase).ok_or(ErrorCode::MathOverflow)?;
        pool.reserve_0 = pool.reserve_0.checked_sub(amount_out).ok_or(ErrorCode::MathOverflow)?;
        if protocol_fee > 0 {
            pool.protocol_fees_1 = pool.protocol_fees_1.checked_add(protocol_fee).ok_or(ErrorCode::MathOverflow)?;
        }
    }

    // Enforce k invariant
    let k_after = (pool.reserve_0 as u128)
        .checked_mul(pool.reserve_1 as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    require!(k_after >= k_before, ErrorCode::InvariantViolated);

    Ok(())
}

pub fn process_swap_exact_output(
    ctx: Context<Swap>,
    amount_out: u64,
    maximum_amount_in: u64,
    zero_for_one: bool,
) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ErrorCode::EmergencyPaused);
    require!(!ctx.accounts.pool_state.is_paused, ErrorCode::PoolPaused);

    let pool = &mut ctx.accounts.pool_state;
    let (reserve_in, reserve_out) = if zero_for_one {
        (pool.reserve_0, pool.reserve_1)
    } else {
        (pool.reserve_1, pool.reserve_0)
    };

    let k_before = (pool.reserve_0 as u128)
        .checked_mul(pool.reserve_1 as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let (amount_in, protocol_fee) = compute_swap_exact_output(
        amount_out,
        reserve_in,
        reserve_out,
        pool.fee_tier,
        ctx.accounts.config.protocol_fee_fraction,
    )?;

    require!(amount_in <= maximum_amount_in, ErrorCode::SlippageExceeded);

    let (vault_in, vault_out) = if zero_for_one {
        (
            ctx.accounts.token_vault_0.to_account_info(),
            ctx.accounts.token_vault_1.to_account_info(),
        )
    } else {
        (
            ctx.accounts.token_vault_1.to_account_info(),
            ctx.accounts.token_vault_0.to_account_info(),
        )
    };

    // 1. Transfer input tokens from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_source.to_account_info(),
                to: vault_in,
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_in,
    )?;

    // 2. Transfer output tokens from vault to user
    let pool_key = pool.key();
    let authority_seeds: &[&[u8]] = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];

    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: vault_out,
                to: ctx.accounts.user_destination.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount_out,
    )?;

    // 3. Update reserves (LP reserve excludes protocol fees to prevent vault desync)
    let reserve_in_increase = amount_in
        .checked_sub(protocol_fee)
        .ok_or(ErrorCode::MathOverflow)?;

    if zero_for_one {
        pool.reserve_0 = pool.reserve_0.checked_add(reserve_in_increase).ok_or(ErrorCode::MathOverflow)?;
        pool.reserve_1 = pool.reserve_1.checked_sub(amount_out).ok_or(ErrorCode::MathOverflow)?;
        if protocol_fee > 0 {
            pool.protocol_fees_0 = pool.protocol_fees_0.checked_add(protocol_fee).ok_or(ErrorCode::MathOverflow)?;
        }
    } else {
        pool.reserve_1 = pool.reserve_1.checked_add(reserve_in_increase).ok_or(ErrorCode::MathOverflow)?;
        pool.reserve_0 = pool.reserve_0.checked_sub(amount_out).ok_or(ErrorCode::MathOverflow)?;
        if protocol_fee > 0 {
            pool.protocol_fees_1 = pool.protocol_fees_1.checked_add(protocol_fee).ok_or(ErrorCode::MathOverflow)?;
        }
    }

    // Enforce k invariant
    let k_after = (pool.reserve_0 as u128)
        .checked_mul(pool.reserve_1 as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    require!(k_after >= k_before, ErrorCode::InvariantViolated);

    Ok(())
}
