use crate::errors::ClmmError;
use crate::state::PositionState;
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(
        mut,
        has_one = owner,
        close = owner
    )]
    pub position: Account<'info, PositionState>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn process_close_position(ctx: Context<ClosePosition>) -> Result<()> {
    let position = &ctx.accounts.position;
    require!(position.liquidity == 0, ClmmError::PositionNotEmpty);
    require!(
        position.tokens_owed_0 == 0 && position.tokens_owed_1 == 0,
        ClmmError::UncollectedFeesRemain
    );

    Ok(())
}

