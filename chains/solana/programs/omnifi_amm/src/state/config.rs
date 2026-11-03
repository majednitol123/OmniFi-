use anchor_lang::prelude::*;

#[account]
#[derive(InitSpace)]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub fee_authority: Pubkey,
    pub protocol_fee_fraction: u32,
    pub emergency_paused: bool,
    pub bump: u8,
}

