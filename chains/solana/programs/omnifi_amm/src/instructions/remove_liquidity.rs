use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use crate::constants::{GLOBAL_CONFIG_SEED, POOL_AUTHORITY_SEED, POOL_STATE_SEED};
use crate::errors::ErrorCode;
use crate::math::mul_div_down;
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
pub struct RemoveLiquidity<'info> {
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
    pub pool_state: Box<Account<'info, PoolState>>,

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

    #[account(
        mut,
        address = pool_state.lp_mint
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub user_token_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_lp: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn process_remove_liquidity(
    ctx: Context<RemoveLiquidity>,
    liquidity: u64,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    require!(liquidity > 0, ErrorCode::ZeroAmount);
    let pool = &mut ctx.accounts.pool_state;
    require!(pool.lp_supply > 0, ErrorCode::InsufficientLiquidityBurned);

    let amount_0 = mul_div_down(
        liquidity as u128,
        pool.reserve_0 as u128,
        pool.lp_supply as u128,
    )? as u64;

    let amount_1 = mul_div_down(
        liquidity as u128,
        pool.reserve_1 as u128,
        pool.lp_supply as u128,
    )? as u64;

    require!(amount_0 >= amount_0_min, ErrorCode::SlippageExceeded);
    require!(amount_1 >= amount_1_min, ErrorCode::SlippageExceeded);

    // Burn LP tokens from user
    token::burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint: ctx.accounts.lp_mint.to_account_info(),
                from: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        liquidity,
    )?;

    // Update pool reserves and supply
    pool.reserve_0 = pool.reserve_0.checked_sub(amount_0).ok_or(ErrorCode::MathOverflow)?;
    pool.reserve_1 = pool.reserve_1.checked_sub(amount_1).ok_or(ErrorCode::MathOverflow)?;
    pool.lp_supply = pool.lp_supply.checked_sub(liquidity).ok_or(ErrorCode::MathOverflow)?;

    // Transfer token 0 from vault to user
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
                from: ctx.accounts.token_vault_0.to_account_info(),
                to: ctx.accounts.user_token_0.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount_0,
    )?;

    // Transfer token 1 from vault to user
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.token_vault_1.to_account_info(),
                to: ctx.accounts.user_token_1.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        amount_1,
    )?;

    Ok(())
}
