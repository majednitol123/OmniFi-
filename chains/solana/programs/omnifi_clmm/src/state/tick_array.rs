use crate::constants::TICK_ARRAY_SIZE;
use crate::errors::ClmmError;
use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Default, Debug, PartialEq)]
pub struct Tick {
    pub initialized: bool,
    pub liquidity_net: i128,
    pub liquidity_gross: u128,
    pub fee_growth_outside_0: u128,
    pub fee_growth_outside_1: u128,
}

#[account]
pub struct TickArray {
    pub pool: Pubkey,
    pub start_tick_index: i32,
    pub bump: u8,
    pub ticks: Vec<Tick>,
}

impl Default for TickArray {
    fn default() -> Self {
        Self {
            pool: Pubkey::default(),
            start_tick_index: 0,
            bump: 0,
            ticks: vec![Tick::default(); TICK_ARRAY_SIZE],
        }
    }
}

impl TickArray {
    // 8 discriminator + 32 pool + 4 start_tick + 1 bump + 4 vec len + 88 * (1 + 16 + 16 + 16 + 16)
    pub const LEN: usize = 8 + 32 + 4 + 1 + 4 + (TICK_ARRAY_SIZE * (1 + 16 + 16 + 16 + 16));

    /// Computes the start tick index for an array given a target tick and tick spacing.
    /// Mathematical floor division is enforced for negative ticks.
    pub fn get_start_tick_index(tick: i32, tick_spacing: u16) -> i32 {
        let ticks_per_array = (TICK_ARRAY_SIZE as i32) * (tick_spacing as i32);

        if tick >= 0 {
            (tick / ticks_per_array) * ticks_per_array
        } else {
            let remainder = tick % ticks_per_array;
            if remainder == 0 {
                tick
            } else {
                ((tick / ticks_per_array) - 1) * ticks_per_array
            }
        }
    }

    /// Computes the 0-based offset of a tick within this array.
    pub fn get_tick_offset(&self, tick: i32, tick_spacing: u16) -> Result<usize> {
        require!(tick >= self.start_tick_index, ClmmError::TickOffsetOutOfBounds);

        let delta = tick - self.start_tick_index;
        require!(
            delta % (tick_spacing as i32) == 0,
            ClmmError::TickNotAligned
        );

        let offset = (delta / (tick_spacing as i32)) as usize;
        require!(
            offset < self.ticks.len(),
            ClmmError::TickOffsetOutOfBounds
        );

        Ok(offset)
    }

    pub fn get_tick(&self, tick: i32, tick_spacing: u16) -> Result<&Tick> {
        let offset = self.get_tick_offset(tick, tick_spacing)?;
        Ok(&self.ticks[offset])
    }

    pub fn get_tick_mut(&mut self, tick: i32, tick_spacing: u16) -> Result<&mut Tick> {
        let offset = self.get_tick_offset(tick, tick_spacing)?;
        Ok(&mut self.ticks[offset])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_start_tick_positive() {
        assert_eq!(TickArray::get_start_tick_index(0, 60), 0);
        assert_eq!(TickArray::get_start_tick_index(100, 60), 0);
        assert_eq!(TickArray::get_start_tick_index(5279, 60), 0);
        assert_eq!(TickArray::get_start_tick_index(5280, 60), 5280);
    }

    #[test]
    fn test_start_tick_negative() {
        // 88 * 60 = 5280
        assert_eq!(TickArray::get_start_tick_index(-1, 60), -5280);
        assert_eq!(TickArray::get_start_tick_index(-60, 60), -5280);
        assert_eq!(TickArray::get_start_tick_index(-5280, 60), -5280);
        assert_eq!(TickArray::get_start_tick_index(-5281, 60), -10560);
    }
}
