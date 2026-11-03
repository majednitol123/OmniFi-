use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};
use crate::constants::{
    ALLOWED_FEE_TIERS, GLOBAL_CONFIG_SEED, LP_MINT_SEED, POOL_AUTHORITY_SEED, POOL_STATE_SEED,
};
use crate::errors::ErrorCode;
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
#[instruction(fee_tier: u32)]
pub struct CreatePool<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        init,
        payer = creator,
        space = 8 + PoolState::INIT_SPACE,
        seeds = [
            POOL_STATE_SEED,
            token_mint_0.key().as_ref(),
            token_mint_1.key().as_ref(),
            &fee_tier.to_le_bytes()
        ],
        bump
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Program derived authority signer for pool vaults and minting
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    pub token_mint_0: Account<'info, Mint>,
    pub token_mint_1: Account<'info, Mint>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_0,
        token::authority = pool_authority
    )]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        token::mint = token_mint_1,
        token::authority = pool_authority
    )]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        seeds = [LP_MINT_SEED, pool_state.key().as_ref()],
        bump,
        mint::decimals = 9,
        mint::authority = pool_authority
    )]
    pub lp_mint: Account<'info, Mint>,

    #[account(mut)]
    pub creator: Signer<'info>,

    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn process_create_pool(ctx: Context<CreatePool>, fee_tier: u32) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ErrorCode::EmergencyPaused);

    let key_0 = ctx.accounts.token_mint_0.key();
    let key_1 = ctx.accounts.token_mint_1.key();

    require!(key_0 != key_1, ErrorCode::IdenticalTokenMints);
    require!(key_0 < key_1, ErrorCode::TokensNotSorted);

    require!(
        ALLOWED_FEE_TIERS.contains(&fee_tier),
        ErrorCode::InvalidFeeTier
    );

    let pool = &mut ctx.accounts.pool_state;
    pool.config = ctx.accounts.config.key();
    pool.token_mint_0 = key_0;
    pool.token_mint_1 = key_1;
    pool.token_vault_0 = ctx.accounts.token_vault_0.key();
    pool.token_vault_1 = ctx.accounts.token_vault_1.key();
    pool.lp_mint = ctx.accounts.lp_mint.key();
    pool.fee_tier = fee_tier;
    pool.reserve_0 = 0;
    pool.reserve_1 = 0;
    pool.lp_supply = 0;
    pool.protocol_fees_0 = 0;
    pool.protocol_fees_1 = 0;
    pool.bump = ctx.bumps.pool_state;
    pool.authority_bump = ctx.bumps.pool_authority;
    pool.is_paused = false;

    Ok(())
}
