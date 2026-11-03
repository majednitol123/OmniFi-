use crate::constants::TICK_ARRAY_SEED;
use crate::errors::ClmmError;
use crate::state::{PoolState, TickArray};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(start_tick_index: i32)]
pub struct InitializeTickArray<'info> {
    pub pool_state: Account<'info, PoolState>,

    #[account(
        init,
        payer = payer,
        space = TickArray::LEN,
        seeds = [
            TICK_ARRAY_SEED,
            pool_state.key().as_ref(),
            &start_tick_index.to_le_bytes()
        ],
        bump
    )]
    pub tick_array: Box<Account<'info, TickArray>>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn process_initialize_tick_array(
    ctx: Context<InitializeTickArray>,
    start_tick_index: i32,
) -> Result<()> {
    let pool = &ctx.accounts.pool_state;
    let expected_start = TickArray::get_start_tick_index(start_tick_index, pool.tick_spacing);

    require!(
        start_tick_index == expected_start,
        ClmmError::InvalidStartTickIndex
    );

    let tick_array = &mut ctx.accounts.tick_array;
    tick_array.pool = pool.key();
    tick_array.start_tick_index = start_tick_index;
    tick_array.bump = ctx.bumps.tick_array;
    tick_array.ticks = vec![crate::state::Tick::default(); crate::constants::TICK_ARRAY_SIZE];

    Ok(())
}
