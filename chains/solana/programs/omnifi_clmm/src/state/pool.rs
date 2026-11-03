use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug)]
pub struct PoolState {
    pub config: Pubkey,
    pub token_mint_0: Pubkey,
    pub token_mint_1: Pubkey,
    pub token_vault_0: Pubkey,
    pub token_vault_1: Pubkey,
    pub fee_tier: u32,
    pub tick_spacing: u16,
    pub sqrt_price_x64: u128,
    pub current_tick: i32,
    pub liquidity: u128,
    pub fee_growth_global_0_x64: u128,
    pub fee_growth_global_1_x64: u128,
    pub protocol_fees_token_0: u64,
    pub protocol_fees_token_1: u64,
    pub bump: u8,
    pub authority_bump: u8,
    pub is_paused: bool,
}

impl PoolState {
    pub const LEN: usize = 8 + (32 * 5) + 4 + 2 + 16 + 4 + 16 + 16 + 16 + 8 + 8 + 1 + 1 + 1;
}

