use anchor_lang::prelude::*;
use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PROTOCOL_FEE_RATE};
use crate::errors::ErrorCode;
use crate::state::GlobalConfig;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Safe as fee authority recipient
    pub fee_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn process_initialize_config(
    ctx: Context<InitializeConfig>,
    protocol_fee_fraction: u32,
) -> Result<()> {
    require!(
        protocol_fee_fraction <= MAX_PROTOCOL_FEE_RATE,
        ErrorCode::ProtocolFeeTooHigh
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.fee_authority = ctx.accounts.fee_authority.key();
    config.protocol_fee_fraction = protocol_fee_fraction;
    config.emergency_paused = false;
    config.bump = ctx.bumps.config;

    Ok(())
}
