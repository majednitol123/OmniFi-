use crate::errors::ClmmError;
use uint::construct_uint;

construct_uint! {
    pub struct U256(4);
}

/// Computes (a * b) / denominator, rounding DOWN
pub fn mul_div_down(a: u128, b: u128, denominator: u128) -> Result<u128, ClmmError> {
    if denominator == 0 {
        return Err(ClmmError::MathOverflow);
    }
    let a_256 = U256::from(a);
    let b_256 = U256::from(b);
    let d_256 = U256::from(denominator);

    let product = a_256.checked_mul(b_256).ok_or(ClmmError::MathOverflow)?;
    let result = product / d_256;

    if result > U256::from(u128::MAX) {
        return Err(ClmmError::MathOverflow);
    }
    Ok(result.as_u128())
}

/// Computes (a * b) / denominator, rounding UP
pub fn mul_div_up(a: u128, b: u128, denominator: u128) -> Result<u128, ClmmError> {
    if denominator == 0 {
        return Err(ClmmError::MathOverflow);
    }
    let a_256 = U256::from(a);
    let b_256 = U256::from(b);
    let d_256 = U256::from(denominator);

    let product = a_256.checked_mul(b_256).ok_or(ClmmError::MathOverflow)?;
    if product.is_zero() {
        return Ok(0);
    }

    let result = (product - U256::one()) / d_256 + U256::one();
    if result > U256::from(u128::MAX) {
        return Err(ClmmError::MathOverflow);
    }
    Ok(result.as_u128())
}

/// Computes (a * b) >> shift, rounding DOWN
pub fn mul_shift_right(a: u128, b: u128, shift: u8) -> Result<u128, ClmmError> {
    let a_256 = U256::from(a);
    let b_256 = U256::from(b);

    let product = a_256.checked_mul(b_256).ok_or(ClmmError::MathOverflow)?;
    let result = product >> shift;

    if result > U256::from(u128::MAX) {
        return Err(ClmmError::MathOverflow);
    }
    Ok(result.as_u128())
}

/// Computes (a * b) >> shift, rounding UP
pub fn mul_shift_right_up(a: u128, b: u128, shift: u8) -> Result<u128, ClmmError> {
    let a_256 = U256::from(a);
    let b_256 = U256::from(b);

    let product = a_256.checked_mul(b_256).ok_or(ClmmError::MathOverflow)?;
    if product.is_zero() {
        return Ok(0);
    }

    let mask = (U256::one() << shift) - U256::one();
    let has_remainder = !(product & mask).is_zero();
    let shifted = product >> shift;

    let result = if has_remainder {
        shifted + U256::one()
    } else {
        shifted
    };

    if result > U256::from(u128::MAX) {
        return Err(ClmmError::MathOverflow);
    }
    Ok(result.as_u128())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_mul_div_down_basic() {
        let res = mul_div_down(100, 200, 50).unwrap();
        assert_eq!(res, 400);

        let res2 = mul_div_down(100, 200, 60).unwrap();
        assert_eq!(res2, 333); // 20000 / 60 = 333.33 -> 333
    }

    #[test]
    fn test_mul_div_up_basic() {
        let res = mul_div_up(100, 200, 50).unwrap();
        assert_eq!(res, 400);

        let res2 = mul_div_up(100, 200, 60).unwrap();
        assert_eq!(res2, 334); // rounds up to 334
    }

    #[test]
    fn test_mul_div_phantom_overflow() {
        // (2^120 * 2^120) overflows u128 but fits in U256
        let a = 1u128 << 100;
        let b = 1u128 << 100;
        let d = 1u128 << 100;
        let res = mul_div_down(a, b, d).unwrap();
        assert_eq!(res, 1u128 << 100);
    }
}
