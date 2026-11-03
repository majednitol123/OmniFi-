use crate::constants::{MAX_TICK, MIN_TICK, POSITION_SEED};
use crate::errors::ClmmError;
use crate::state::{PoolState, PositionState};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(tick_lower_index: i32, tick_upper_index: i32)]
pub struct OpenPosition<'info> {
    pub pool_state: Account<'info, PoolState>,

    #[account(
        init,
        payer = payer,
        space = PositionState::LEN,
        seeds = [
            POSITION_SEED,
            pool_state.key().as_ref(),
            owner.key().as_ref(),
            &tick_lower_index.to_le_bytes(),
            &tick_upper_index.to_le_bytes()
        ],
        bump
    )]
    pub position: Account<'info, PositionState>,

    /// CHECK: Owner of the position (PDA-backed ownership)
    pub owner: UncheckedAccount<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn process_open_position(
    ctx: Context<OpenPosition>,
    tick_lower_index: i32,
    tick_upper_index: i32,
) -> Result<()> {
    require!(
        tick_lower_index < tick_upper_index,
        ClmmError::InvalidTickRange
    );

    require!(
        tick_lower_index >= MIN_TICK && tick_upper_index <= MAX_TICK,
        ClmmError::TickOutOfBounds
    );

    let tick_spacing = ctx.accounts.pool_state.tick_spacing as i32;
    require!(
        tick_lower_index % tick_spacing == 0 && tick_upper_index % tick_spacing == 0,
        ClmmError::TickNotAligned
    );

    let position = &mut ctx.accounts.position;
    position.pool = ctx.accounts.pool_state.key();
    position.owner = ctx.accounts.owner.key();
    position.tick_lower_index = tick_lower_index;
    position.tick_upper_index = tick_upper_index;
    position.liquidity = 0;
    position.fee_growth_inside_0_last_x64 = 0;
    position.fee_growth_inside_1_last_x64 = 0;
    position.tokens_owed_0 = 0;
    position.tokens_owed_1 = 0;
    position.bump = ctx.bumps.position;

    Ok(())
}

