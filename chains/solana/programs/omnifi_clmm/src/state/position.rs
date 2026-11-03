use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug)]
pub struct PositionState {
    pub pool: Pubkey,
    pub owner: Pubkey,
    pub tick_lower_index: i32,
    pub tick_upper_index: i32,
    pub liquidity: u128,
    pub fee_growth_inside_0_last_x64: u128,
    pub fee_growth_inside_1_last_x64: u128,
    pub tokens_owed_0: u64,
    pub tokens_owed_1: u64,
    pub bump: u8,
}

impl PositionState {
    pub const LEN: usize = 8 + 32 + 32 + 4 + 4 + 16 + 16 + 16 + 8 + 8 + 1;
}

