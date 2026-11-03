use anchor_lang::prelude::*;
use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PROTOCOL_FEE_RATE, POOL_STATE_SEED};
use crate::errors::ErrorCode;
use crate::state::{GlobalConfig, PoolState};

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,

    pub authority: Signer<'info>,

    /// CHECK: New fee authority if updating
    pub new_fee_authority: Option<UncheckedAccount<'info>>,
}

pub fn process_update_config(
    ctx: Context<UpdateConfig>,
    new_protocol_fee_fraction: Option<u32>,
) -> Result<()> {
    let config = &mut ctx.accounts.config;

    if let Some(fraction) = new_protocol_fee_fraction {
        require!(fraction <= MAX_PROTOCOL_FEE_RATE, ErrorCode::ProtocolFeeTooHigh);
        config.protocol_fee_fraction = fraction;
    }

    if let Some(new_fee_auth) = &ctx.accounts.new_fee_authority {
        config.fee_authority = new_fee_auth.key();
    }

    Ok(())
}

#[derive(Accounts)]
pub struct SetEmergencyPaused<'info> {
    #[account(
        mut,
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
    )]
    pub config: Account<'info, GlobalConfig>,

    pub authority: Signer<'info>,
}

pub fn process_set_emergency_paused(ctx: Context<SetEmergencyPaused>, paused: bool) -> Result<()> {
    ctx.accounts.config.emergency_paused = paused;
    Ok(())
}

#[derive(Accounts)]
pub struct PausePool<'info> {
    #[account(
        seeds = [GLOBAL_CONFIG_SEED],
        bump = config.bump,
        has_one = authority @ ErrorCode::Unauthorized
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

    pub authority: Signer<'info>,
}

pub fn process_pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
    ctx.accounts.pool_state.is_paused = paused;
    Ok(())
}
