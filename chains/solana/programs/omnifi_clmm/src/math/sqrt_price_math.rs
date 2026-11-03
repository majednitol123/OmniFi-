use crate::errors::ClmmError;
use crate::math::full_math::{mul_div_down, mul_div_up, mul_shift_right, mul_shift_right_up, U256};

/// Computes token 0 delta between two sqrt prices:
/// delta_x = L * (sqrt_b - sqrt_a) / (sqrt_a * sqrt_b)
pub fn get_amount_0_delta(
    mut sqrt_ratio_a_x64: u128,
    mut sqrt_ratio_b_x64: u128,
    liquidity: u128,
    round_up: bool,
) -> Result<u64, ClmmError> {
    if sqrt_ratio_a_x64 > sqrt_ratio_b_x64 {
        std::mem::swap(&mut sqrt_ratio_a_x64, &mut sqrt_ratio_b_x64);
    }
    if sqrt_ratio_a_x64 == 0 || liquidity == 0 {
        return Ok(0);
    }

    let diff = sqrt_ratio_b_x64 - sqrt_ratio_a_x64;
    let numerator_1 = U256::from(liquidity) << 64;
    let numerator_2 = U256::from(diff);

    let product = numerator_1.checked_mul(numerator_2).ok_or(ClmmError::MathOverflow)?;
    let denominator = U256::from(sqrt_ratio_a_x64)
        .checked_mul(U256::from(sqrt_ratio_b_x64))
        .ok_or(ClmmError::MathOverflow)?;

    let result = if round_up {
        if product.is_zero() {
            U256::zero()
        } else {
            (product - U256::one()) / denominator + U256::one()
        }
    } else {
        product / denominator
    };

    if result > U256::from(u64::MAX) {
        return Err(ClmmError::MathOverflow);
    }

    Ok(result.as_u64())
}

/// Computes token 1 delta between two sqrt prices:
/// delta_y = L * (sqrt_b - sqrt_a) / 2^64
pub fn get_amount_1_delta(
    mut sqrt_ratio_a_x64: u128,
    mut sqrt_ratio_b_x64: u128,
    liquidity: u128,
    round_up: bool,
) -> Result<u64, ClmmError> {
    if sqrt_ratio_a_x64 > sqrt_ratio_b_x64 {
        std::mem::swap(&mut sqrt_ratio_a_x64, &mut sqrt_ratio_b_x64);
    }
    if liquidity == 0 {
        return Ok(0);
    }

    let diff = sqrt_ratio_b_x64 - sqrt_ratio_a_x64;

    let result = if round_up {
        mul_shift_right_up(liquidity, diff, 64)?
    } else {
        mul_shift_right(liquidity, diff, 64)?
    };

    if result > u64::MAX as u128 {
        return Err(ClmmError::MathOverflow);
    }

    Ok(result as u64)
}

/// Calculates the next sqrt price given an input token amount
pub fn get_next_sqrt_price_from_input(
    sqrt_price_x64: u128,
    liquidity: u128,
    amount_in: u64,
    zero_for_one: bool,
) -> Result<u128, ClmmError> {
    if sqrt_price_x64 == 0 || liquidity == 0 || amount_in == 0 {
        return Ok(sqrt_price_x64);
    }

    if zero_for_one {
        // Price decreases: sqrt_next = L * sqrt / (L + amount_in * sqrt / 2^64)
        let amount_in_256 = U256::from(amount_in);
        let sqrt_256 = U256::from(sqrt_price_x64);
        let liquidity_256 = U256::from(liquidity);

        let numerator = (liquidity_256 << 64)
            .checked_mul(sqrt_256)
            .ok_or(ClmmError::MathOverflow)?;

        let product_in = amount_in_256
            .checked_mul(sqrt_256)
            .ok_or(ClmmError::MathOverflow)?;
        let denominator = (liquidity_256 << 64)
            .checked_add(product_in)
            .ok_or(ClmmError::MathOverflow)?;

        // Round up on division for input
        let next_price = (numerator + denominator - U256::one()) / denominator;
        if next_price > U256::from(u128::MAX) {
            return Err(ClmmError::MathOverflow);
        }
        Ok(next_price.as_u128())
    } else {
        // Price increases: sqrt_next = sqrt + (amount_in * 2^64 / L)
        let quotient = mul_div_down(amount_in as u128, 1u128 << 64, liquidity)?;
        let next_price = sqrt_price_x64
            .checked_add(quotient)
            .ok_or(ClmmError::MathOverflow)?;
        Ok(next_price)
    }
}

/// Calculates the next sqrt price given an output token amount
pub fn get_next_sqrt_price_from_output(
    sqrt_price_x64: u128,
    liquidity: u128,
    amount_out: u64,
    zero_for_one: bool,
) -> Result<u128, ClmmError> {
    if sqrt_price_x64 == 0 || liquidity == 0 || amount_out == 0 {
        return Ok(sqrt_price_x64);
    }

    if zero_for_one {
        // Price decreases: sqrt_next = sqrt - (amount_out * 2^64 / L)
        let quotient = mul_div_up(amount_out as u128, 1u128 << 64, liquidity)?;
        let next_price = sqrt_price_x64
            .checked_sub(quotient)
            .ok_or(ClmmError::MathOverflow)?;
        Ok(next_price)
    } else {
        // Price increases: sqrt_next = L * sqrt / (L - amount_out * sqrt / 2^64)
        let amount_out_256 = U256::from(amount_out);
        let sqrt_256 = U256::from(sqrt_price_x64);
        let liquidity_256 = U256::from(liquidity);

        let numerator = (liquidity_256 << 64)
            .checked_mul(sqrt_256)
            .ok_or(ClmmError::MathOverflow)?;

        let product_out = amount_out_256
            .checked_mul(sqrt_256)
            .ok_or(ClmmError::MathOverflow)?;
        let denominator = (liquidity_256 << 64)
            .checked_sub(product_out)
            .ok_or(ClmmError::MathOverflow)?;

        let next_price = (numerator + denominator - U256::one()) / denominator;
        if next_price > U256::from(u128::MAX) {
            return Err(ClmmError::MathOverflow);
        }
        Ok(next_price.as_u128())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_amount_0_and_1_delta_zero() {
        let p = 1u128 << 64;
        let d0 = get_amount_0_delta(p, p, 1000, false).unwrap();
        let d1 = get_amount_1_delta(p, p, 1000, false).unwrap();
        assert_eq!(d0, 0);
        assert_eq!(d1, 0);
    }

    #[test]
    fn test_amount_1_delta_basic() {
        let p_a = 1u128 << 64; // 1.0
        let p_b = 2u128 << 64; // 2.0
        let l = 1000u128;
        // delta_y = 1000 * (2 - 1) = 1000
        let d1 = get_amount_1_delta(p_a, p_b, l, false).unwrap();
        assert_eq!(d1, 1000);
    }
}

