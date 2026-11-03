use anchor_lang::prelude::*;

#[account]
#[derive(Default, Debug)]
pub struct GlobalConfig {
    pub authority: Pubkey,
    pub fee_authority: Pubkey,
    pub default_protocol_fee_fraction: u32,
    pub emergency_paused: bool,
    pub bump: u8,
}

impl GlobalConfig {
    pub const LEN: usize = 8 + 32 + 32 + 4 + 1 + 1;
}

