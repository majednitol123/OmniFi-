use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct PoolState {
    pub config: Pubkey,
    pub token_mint_0: Pubkey,
    pub token_mint_1: Pubkey,
    pub token_vault_0: Pubkey,
    pub token_vault_1: Pubkey,
    pub lp_mint: Pubkey,
    pub fee_tier: u32,
    pub reserve_0: u64,
    pub reserve_1: u64,
    pub lp_supply: u64,
    pub protocol_fees_0: u64,
    pub protocol_fees_1: u64,
    pub bump: u8,
    pub authority_bump: u8,
    pub is_paused: bool,
}

