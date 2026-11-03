use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};
use crate::constants::{
    GLOBAL_CONFIG_SEED, MINIMUM_LIQUIDITY, POOL_AUTHORITY_SEED, POOL_STATE_SEED,
};
use crate::errors::ErrorCode;
use crate::math::{mul_div_down, sqrt};
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
pub struct AddLiquidity<'info> {
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

pub fn process_add_liquidity(
    ctx: Context<AddLiquidity>,
    amount_0_desired: u64,
    amount_1_desired: u64,
    amount_0_min: u64,
    amount_1_min: u64,
) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ErrorCode::EmergencyPaused);
    require!(!ctx.accounts.pool_state.is_paused, ErrorCode::PoolPaused);
    require!(amount_0_desired > 0 && amount_1_desired > 0, ErrorCode::ZeroAmount);

    let pool = &mut ctx.accounts.pool_state;
    let (amount_0, amount_1, liquidity);

    if pool.lp_supply == 0 {
        // Initial liquidity
        let initial_liquidity = sqrt(
            (amount_0_desired as u128)
                .checked_mul(amount_1_desired as u128)
                .ok_or(ErrorCode::MathOverflow)?
        ) as u64;

        require!(
            initial_liquidity > MINIMUM_LIQUIDITY,
            ErrorCode::InsufficientLiquidityMinted
        );

        amount_0 = amount_0_desired;
        amount_1 = amount_1_desired;
        // Deduct permanently locked MINIMUM_LIQUIDITY
        liquidity = initial_liquidity - MINIMUM_LIQUIDITY;
        pool.lp_supply = initial_liquidity;
    } else {
        // Proportional liquidity
        let amount_1_optimal = mul_div_down(
            amount_0_desired as u128,
            pool.reserve_1 as u128,
            pool.reserve_0 as u128,
        )? as u64;

        if amount_1_optimal <= amount_1_desired {
            require!(amount_1_optimal >= amount_1_min, ErrorCode::SlippageExceeded);
            amount_0 = amount_0_desired;
            amount_1 = amount_1_optimal;
        } else {
            let amount_0_optimal = mul_div_down(
                amount_1_desired as u128,
                pool.reserve_0 as u128,
                pool.reserve_1 as u128,
            )? as u64;
            require!(amount_0_optimal <= amount_0_desired, ErrorCode::MathOverflow);
            require!(amount_0_optimal >= amount_0_min, ErrorCode::SlippageExceeded);
            amount_0 = amount_0_optimal;
            amount_1 = amount_1_desired;
        }

        let liquidity_0 = mul_div_down(
            amount_0 as u128,
            pool.lp_supply as u128,
            pool.reserve_0 as u128,
        )? as u64;

        let liquidity_1 = mul_div_down(
            amount_1 as u128,
            pool.lp_supply as u128,
            pool.reserve_1 as u128,
        )? as u64;

        liquidity = std::cmp::min(liquidity_0, liquidity_1);
        require!(liquidity > 0, ErrorCode::InsufficientLiquidityMinted);
        pool.lp_supply = pool.lp_supply.checked_add(liquidity).ok_or(ErrorCode::MathOverflow)?;
    }

    require!(amount_0 >= amount_0_min, ErrorCode::SlippageExceeded);
    require!(amount_1 >= amount_1_min, ErrorCode::SlippageExceeded);

    // Update reserves
    pool.reserve_0 = pool.reserve_0.checked_add(amount_0).ok_or(ErrorCode::MathOverflow)?;
    pool.reserve_1 = pool.reserve_1.checked_add(amount_1).ok_or(ErrorCode::MathOverflow)?;

    // Transfer token 0 from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_0.to_account_info(),
                to: ctx.accounts.token_vault_0.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_0,
    )?;

    // Transfer token 1 from user to vault
    token::transfer(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Transfer {
                from: ctx.accounts.user_token_1.to_account_info(),
                to: ctx.accounts.token_vault_1.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        ),
        amount_1,
    )?;

    // Mint LP tokens to user
    let pool_key = pool.key();
    let authority_seeds: &[&[u8]] = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];

    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint: ctx.accounts.lp_mint.to_account_info(),
                to: ctx.accounts.user_lp.to_account_info(),
                authority: ctx.accounts.pool_authority.to_account_info(),
            },
            &[authority_seeds],
        ),
        liquidity,
    )?;

    Ok(())
}
