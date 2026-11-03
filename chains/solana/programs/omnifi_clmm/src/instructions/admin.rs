use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PROTOCOL_FEE_FRACTION, POOL_AUTHORITY_SEED};
use crate::errors::ClmmError;
use crate::state::{GlobalConfig, PoolState};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, GlobalConfig>,

    pub authority: Signer<'info>,

    /// CHECK: New fee authority
    pub new_fee_authority: Option<UncheckedAccount<'info>>,
}

#[derive(Accounts)]
pub struct SetEmergencyPaused<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, GlobalConfig>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct PausePool<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        has_one = config
    )]
    pub pool_state: Account<'info, PoolState>,

    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct CollectProtocolFees<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = fee_authority
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        has_one = config,
        has_one = token_vault_0,
        has_one = token_vault_1
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Pool authority PDA for CPI signing
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump = pool_state.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_token_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub recipient_token_1: Account<'info, TokenAccount>,

    pub fee_authority: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn process_update_config(
    ctx: Context<UpdateConfig>,
    new_protocol_fee_fraction: Option<u32>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(fraction) = new_protocol_fee_fraction {
        require!(
            fraction <= MAX_PROTOCOL_FEE_FRACTION,
            ClmmError::ProtocolFeeTooHigh
        );
        config.default_protocol_fee_fraction = fraction;
    }

    if let Some(new_fee_auth) = &ctx.accounts.new_fee_authority {
        config.fee_authority = new_fee_auth.key();
    }

    Ok(())
}

pub fn process_set_emergency_paused(
    ctx: Context<SetEmergencyPaused>,
    emergency_paused: bool,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.emergency_paused = emergency_paused;
    Ok(())
}

pub fn process_pause_pool(ctx: Context<PausePool>, is_paused: bool) -> Result<()> {
    let pool = &mut ctx.accounts.pool_state;
    pool.is_paused = is_paused;
    Ok(())
}

pub fn process_collect_protocol_fees(ctx: Context<CollectProtocolFees>) -> Result<()> {
    let pool = &mut ctx.accounts.pool_state;

    let amount_0 = pool.protocol_fees_token_0;
    let amount_1 = pool.protocol_fees_token_1;

    require!(amount_0 > 0 || amount_1 > 0, ClmmError::ZeroAmount);

    let pool_key = pool.key();
    let authority_seeds = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];
    let signer = &[&authority_seeds[..]];

    if amount_0 > 0 {
        pool.protocol_fees_token_0 = 0;
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault_0.to_account_info(),
            to: ctx.accounts.recipient_token_0.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            ),
            amount_0,
        )?;
    }

    if amount_1 > 0 {
        pool.protocol_fees_token_1 = 0;
        let cpi_accounts = Transfer {
            from: ctx.accounts.token_vault_1.to_account_info(),
            to: ctx.accounts.recipient_token_1.to_account_info(),
            authority: ctx.accounts.pool_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                cpi_accounts,
                signer,
            ),
            amount_1,
        )?;
    }

    Ok(())
}

