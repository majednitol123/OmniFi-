use crate::constants::{GLOBAL_CONFIG_SEED, MAX_PROTOCOL_FEE_FRACTION};
use crate::errors::ClmmError;
use crate::state::GlobalConfig;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = authority,
        space = GlobalConfig::LEN,
        seeds = [GLOBAL_CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, GlobalConfig>,

    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: Protocol fee recipient/authority
    pub fee_authority: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

pub fn process_initialize_config(
    ctx: Context<InitializeConfig>,
    default_protocol_fee_fraction: u32,
) -> Result<()> {
    require!(
        default_protocol_fee_fraction <= MAX_PROTOCOL_FEE_FRACTION,
        ClmmError::ProtocolFeeTooHigh
    );

    let config = &mut ctx.accounts.config;
    config.authority = ctx.accounts.authority.key();
    config.fee_authority = ctx.accounts.fee_authority.key();
    config.default_protocol_fee_fraction = default_protocol_fee_fraction;
    config.emergency_paused = false;
    config.bump = ctx.bumps.config;

    Ok(())
}

