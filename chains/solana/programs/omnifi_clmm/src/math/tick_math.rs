use crate::constants::{MAX_SQRT_PRICE, MAX_TICK, MIN_SQRT_PRICE, MIN_TICK};
use crate::errors::ClmmError;
use crate::math::full_math::U256;

/// Calculates sqrt(1.0001^tick) * 2^64 as a Q32.64 fixed-point integer
pub fn get_sqrt_price_at_tick(tick: i32) -> Result<u128, ClmmError> {
    if !(MIN_TICK..=MAX_TICK).contains(&tick) {
        return Err(ClmmError::TickOutOfBounds);
    }

    let abs_tick = tick.unsigned_abs();

    let mut ratio = if abs_tick & 0x1 != 0 {
        U256::from_str_radix("fffcb933bd6fad37aa2d162d1a594001", 16).unwrap()
    } else {
        U256::one() << 128
    };

    if abs_tick & 0x2 != 0 {
        ratio = (ratio * U256::from_str_radix("fff97272373d413259a46990580e213a", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x4 != 0 {
        ratio = (ratio * U256::from_str_radix("fff2e50f5f656932ef12357cf3c7fdcc", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x8 != 0 {
        ratio = (ratio * U256::from_str_radix("ffe5caca7e10e4e61c3624eaa0941cd0", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x10 != 0 {
        ratio = (ratio * U256::from_str_radix("ffcb9843d60f6159c9db58835c926644", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x20 != 0 {
        ratio = (ratio * U256::from_str_radix("ff973b41fa98c081472e6896dfb254c0", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x40 != 0 {
        ratio = (ratio * U256::from_str_radix("ff2ea16466c96a3843ec78b326b52861", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x80 != 0 {
        ratio = (ratio * U256::from_str_radix("fe5dee046a99a2a811c461f1969c3053", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x100 != 0 {
        ratio = (ratio * U256::from_str_radix("fcbe86c7900a88aedcffc83b479aa3a4", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x200 != 0 {
        ratio = (ratio * U256::from_str_radix("f987a7253ac413176f2b074cf7815e54", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x400 != 0 {
        ratio = (ratio * U256::from_str_radix("f3392b0822b70005940c7a398e4b70f3", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x800 != 0 {
        ratio = (ratio * U256::from_str_radix("e7159475a2c29b7443b29c7fa6e889d9", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x1000 != 0 {
        ratio = (ratio * U256::from_str_radix("d097f3bdfd2022b8845ad8f792aa5825", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x2000 != 0 {
        ratio = (ratio * U256::from_str_radix("a9f746462d870fdf8a65dc1f90e061e5", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x4000 != 0 {
        ratio = (ratio * U256::from_str_radix("70d869a156d2a1b890bb3df62baf32f7", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x8000 != 0 {
        ratio = (ratio * U256::from_str_radix("31be135f97d08fd981231505542fcfa6", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x10000 != 0 {
        ratio = (ratio * U256::from_str_radix("9aa508b5b7a84e1c677de54f3e99bc9", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x20000 != 0 {
        ratio = (ratio * U256::from_str_radix("5d6af8dedb81196699c329225ee604", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x40000 != 0 {
        ratio = (ratio * U256::from_str_radix("2216e584f5fa1ea926041bedfe98", 16).unwrap()) >> 128;
    }
    if abs_tick & 0x80000 != 0 {
        ratio = (ratio * U256::from_str_radix("48a170391f7dc42444e8fa2", 16).unwrap()) >> 128;
    }

    if tick > 0 {
        ratio = U256::MAX / ratio;
    }

    // Convert from Q128.128 to Q32.64 by shifting right by 64 bits (rounding up)
    let remainder = ratio & ((U256::one() << 64) - U256::one());
    let sqrt_price_256 = (ratio >> 64) + if remainder.is_zero() { U256::zero() } else { U256::one() };

    if sqrt_price_256 > U256::from(u128::MAX) {
        return Err(ClmmError::MathOverflow);
    }

    Ok(sqrt_price_256.as_u128())
}

/// Calculates the greatest tick value such that get_sqrt_price_at_tick(tick) <= sqrt_price_x64
pub fn get_tick_at_sqrt_price(sqrt_price_x64: u128) -> Result<i32, ClmmError> {
    if !(MIN_SQRT_PRICE..=MAX_SQRT_PRICE).contains(&sqrt_price_x64) {
        return Err(ClmmError::SqrtPriceOutOfBounds);
    }

    let mut low = MIN_TICK;
    let mut high = MAX_TICK;

    while low < high {
        let mid = (low + high + 1) / 2;
        let p = get_sqrt_price_at_tick(mid)?;
        if p <= sqrt_price_x64 {
            low = mid;
        } else {
            high = mid - 1;
        }
    }

    Ok(low)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_tick_0_is_one() {
        let sqrt_p = get_sqrt_price_at_tick(0).unwrap();
        // 1.0 in Q32.64 is exactly 2^64
        assert_eq!(sqrt_p, 1u128 << 64);
        let tick = get_tick_at_sqrt_price(sqrt_p).unwrap();
        assert_eq!(tick, 0);
    }

    #[test]
    fn test_tick_bounds() {
        let min_p = get_sqrt_price_at_tick(MIN_TICK).unwrap();
        let max_p = get_sqrt_price_at_tick(MAX_TICK).unwrap();
        println!("min_p = {}, max_p = {}, MAX_SQRT_PRICE = {}", min_p, max_p, MAX_SQRT_PRICE);
        assert!(min_p >= MIN_SQRT_PRICE);
        assert!(max_p <= MAX_SQRT_PRICE);
    }

    #[test]
    fn test_tick_monotonicity() {
        let p_neg100 = get_sqrt_price_at_tick(-100).unwrap();
        let p_0 = get_sqrt_price_at_tick(0).unwrap();
        let p_100 = get_sqrt_price_at_tick(100).unwrap();

        assert!(p_neg100 < p_0);
        assert!(p_0 < p_100);
    }
}
