use crate::constants::{
    FEE_TIERS, GLOBAL_CONFIG_SEED, MAX_SQRT_PRICE, MIN_SQRT_PRICE, POOL_AUTHORITY_SEED,
    POOL_STATE_SEED,
};
use crate::errors::ClmmError;
use crate::math::tick_math::get_tick_at_sqrt_price;
use crate::state::{GlobalConfig, PoolState};
use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

#[derive(Accounts)]
#[instruction(fee_tier: u32, tick_spacing: u16)]
pub struct InitializePool<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = payer,
        space = PoolState::LEN,
        seeds = [
            POOL_STATE_SEED,
            token_mint_0.key().as_ref(),
            token_mint_1.key().as_ref(),
            &fee_tier.to_le_bytes()
        ],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Pool authority PDA for CPI signing and vault ownership
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub token_mint_0: Account<'info, Mint>,
    pub token_mint_1: Account<'info, Mint>,

    #[account(
        init,
        payer = payer,
        token::mint = token_mint_0,
        token::authority = pool_authority
    )]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = payer,
        token::mint = token_mint_1,
        token::authority = pool_authority
    )]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn process_initialize_pool(
    ctx: Context<InitializePool>,
    fee_tier: u32,
    tick_spacing: u16,
    init_sqrt_price_x64: u128,
) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ClmmError::EmergencyPaused);

    // Validate lexicographical token order
    let mint_0 = ctx.accounts.token_mint_0.key();
    let mint_1 = ctx.accounts.token_mint_1.key();
    require!(mint_0 < mint_1, ClmmError::TokensNotSorted);
    require!(mint_0 != mint_1, ClmmError::IdenticalTokenMints);

    // Validate fee tier and tick spacing against supported list
    let valid_tier = FEE_TIERS
        .iter()
        .any(|(fee, spacing)| *fee == fee_tier && *spacing == tick_spacing);
    require!(valid_tier, ClmmError::InvalidFeeTier);

    // Validate sqrt price bounds
    require!(
        (MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&init_sqrt_price_x64),
        ClmmError::SqrtPriceOutOfBounds
    );

    let current_tick = get_tick_at_sqrt_price(init_sqrt_price_x64)?;

    let pool = &mut ctx.accounts.pool_state;
    pool.config = ctx.accounts.config.key();
    pool.token_mint_0 = mint_0;
    pool.token_mint_1 = mint_1;
    pool.token_vault_0 = ctx.accounts.token_vault_0.key();
    pool.token_vault_1 = ctx.accounts.token_vault_1.key();
    pool.fee_tier = fee_tier;
    pool.tick_spacing = tick_spacing;
    pool.sqrt_price_x64 = init_sqrt_price_x64;
    pool.current_tick = current_tick;
    pool.liquidity = 0;
    pool.fee_growth_global_0_x64 = 0;
    pool.fee_growth_global_1_x64 = 0;
    pool.protocol_fees_token_0 = 0;
    pool.protocol_fees_token_1 = 0;
    pool.bump = ctx.bumps.pool_state;
    pool.authority_bump = ctx.bumps.pool_authority;
    pool.is_paused = false;

    Ok(())
}
