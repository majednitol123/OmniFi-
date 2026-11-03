use crate::constants::FEE_DENOMINATOR;
use crate::errors::ClmmError;
use crate::math::full_math::{mul_div_down, mul_div_up};
use crate::math::sqrt_price_math::{
    get_amount_0_delta, get_amount_1_delta, get_next_sqrt_price_from_input,
    get_next_sqrt_price_from_output,
};

pub struct SwapStepResult {
    pub sqrt_price_next_x64: u128,
    pub amount_in: u64,
    pub amount_out: u64,
    pub fee_amount: u64,
}

/// Computes the result of a single swap step within one tick interval
pub fn compute_swap_step(
    sqrt_price_current_x64: u128,
    sqrt_price_target_x64: u128,
    liquidity: u128,
    amount_remaining: u64,
    fee_tier: u32,
    is_exact_input: bool,
    zero_for_one: bool,
) -> Result<SwapStepResult, ClmmError> {
    if liquidity == 0 {
        return Ok(SwapStepResult {
            sqrt_price_next_x64: sqrt_price_target_x64,
            amount_in: 0,
            amount_out: 0,
            fee_amount: 0,
        });
    }

    let (sqrt_price_next_x64, amount_in, amount_out, fee_amount) = if is_exact_input {
        // Calculate amount_remaining net of fee
        let amount_remaining_less_fee = mul_div_down(
            amount_remaining as u128,
            (FEE_DENOMINATOR - fee_tier) as u128,
            FEE_DENOMINATOR as u128,
        )? as u64;

        let max_amount_in = if zero_for_one {
            get_amount_0_delta(sqrt_price_target_x64, sqrt_price_current_x64, liquidity, true)?
        } else {
            get_amount_1_delta(sqrt_price_current_x64, sqrt_price_target_x64, liquidity, true)?
        };

        let (next_price, step_in) = if amount_remaining_less_fee >= max_amount_in {
            // Reached target price
            (sqrt_price_target_x64, max_amount_in)
        } else {
            // Did not reach target price
            let next_p = get_next_sqrt_price_from_input(
                sqrt_price_current_x64,
                liquidity,
                amount_remaining_less_fee,
                zero_for_one,
            )?;
            let step_i = if zero_for_one {
                get_amount_0_delta(next_p, sqrt_price_current_x64, liquidity, true)?
            } else {
                get_amount_1_delta(sqrt_price_current_x64, next_p, liquidity, true)?
            };
            (next_p, step_i)
        };

        let step_out = if zero_for_one {
            get_amount_1_delta(next_price, sqrt_price_current_x64, liquidity, false)?
        } else {
            get_amount_0_delta(sqrt_price_current_x64, next_price, liquidity, false)?
        };

        let step_fee = if next_price == sqrt_price_target_x64 {
            mul_div_up(
                step_in as u128,
                fee_tier as u128,
                (FEE_DENOMINATOR - fee_tier) as u128,
            )? as u64
        } else {
            amount_remaining.saturating_sub(step_in)
        };

        (next_price, step_in, step_out, step_fee)
    } else {
        // Exact output calculation
        let max_amount_out = if zero_for_one {
            get_amount_1_delta(sqrt_price_target_x64, sqrt_price_current_x64, liquidity, false)?
        } else {
            get_amount_0_delta(sqrt_price_current_x64, sqrt_price_target_x64, liquidity, false)?
        };

        let (next_price, step_out) = if amount_remaining >= max_amount_out {
            (sqrt_price_target_x64, max_amount_out)
        } else {
            let next_p = get_next_sqrt_price_from_output(
                sqrt_price_current_x64,
                liquidity,
                amount_remaining,
                zero_for_one,
            )?;
            let step_o = if zero_for_one {
                get_amount_1_delta(next_p, sqrt_price_current_x64, liquidity, false)?
            } else {
                get_amount_0_delta(sqrt_price_current_x64, next_p, liquidity, false)?
            };
            (next_p, step_o)
        };

        let step_in = if zero_for_one {
            get_amount_0_delta(next_price, sqrt_price_current_x64, liquidity, true)?
        } else {
            get_amount_1_delta(sqrt_price_current_x64, next_price, liquidity, true)?
        };

        let step_fee = mul_div_up(
            step_in as u128,
            fee_tier as u128,
            (FEE_DENOMINATOR - fee_tier) as u128,
        )? as u64;

        (next_price, step_in, step_out, step_fee)
    };

    Ok(SwapStepResult {
        sqrt_price_next_x64,
        amount_in,
        amount_out,
        fee_amount,
    })
}
