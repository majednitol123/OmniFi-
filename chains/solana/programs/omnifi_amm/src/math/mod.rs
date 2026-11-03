use crate::constants::FEE_DENOMINATOR;
use crate::errors::ErrorCode;
use anchor_lang::prelude::*;

/// Babylonian method for integer square root
pub fn sqrt(y: u128) -> u128 {
    if y > 3 {
        let mut z = y;
        let mut x = y / 2 + 1;
        while x < z {
            z = x;
            x = (y / x + x) / 2;
        }
        z
    } else if y != 0 {
        1
    } else {
        0
    }
}

pub fn mul_div_down(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, ErrorCode::MathOverflow);
    let prod = a.checked_mul(b).ok_or(ErrorCode::MathOverflow)?;
    Ok(prod / c)
}

pub fn mul_div_up(a: u128, b: u128, c: u128) -> Result<u128> {
    require!(c != 0, ErrorCode::MathOverflow);
    let prod = a.checked_mul(b).ok_or(ErrorCode::MathOverflow)?;
    if prod == 0 {
        return Ok(0);
    }
    Ok((prod - 1) / c + 1)
}

/// Compute swap output:
/// fee = ceil(amount_in * fee_tier / FEE_DENOMINATOR)
/// amount_in_after_fee = amount_in - fee
/// amount_out = floor(reserve_out * amount_in_after_fee / (reserve_in + amount_in_after_fee))
/// protocol_fee = floor(fee * protocol_fee_fraction / FEE_DENOMINATOR)
pub fn compute_swap_exact_input(
    amount_in: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_tier: u32,
    protocol_fee_fraction: u32,
) -> Result<(u64, u64)> {
    require!(amount_in > 0, ErrorCode::ZeroAmount);
    require!(reserve_in > 0 && reserve_out > 0, ErrorCode::ZeroAmount);

    let fee = mul_div_up(
        amount_in as u128,
        fee_tier as u128,
        FEE_DENOMINATOR as u128,
    )? as u64;

    let amount_in_after_fee = amount_in.checked_sub(fee).ok_or(ErrorCode::MathOverflow)?;

    let numerator = (reserve_out as u128)
        .checked_mul(amount_in_after_fee as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let denominator = (reserve_in as u128)
        .checked_add(amount_in_after_fee as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let amount_out = (numerator / denominator) as u64;

    let protocol_fee = if protocol_fee_fraction > 0 {
        mul_div_down(
            fee as u128,
            protocol_fee_fraction as u128,
            FEE_DENOMINATOR as u128,
        )? as u64
    } else {
        0
    };

    Ok((amount_out, protocol_fee))
}

/// Compute required swap input for exact output:
/// amount_in_after_fee = ceil(reserve_in * amount_out / (reserve_out - amount_out))
/// amount_in = ceil(amount_in_after_fee * FEE_DENOMINATOR / (FEE_DENOMINATOR - fee_tier))
pub fn compute_swap_exact_output(
    amount_out: u64,
    reserve_in: u64,
    reserve_out: u64,
    fee_tier: u32,
    protocol_fee_fraction: u32,
) -> Result<(u64, u64)> {
    require!(amount_out > 0, ErrorCode::ZeroAmount);
    require!(amount_out < reserve_out, ErrorCode::ZeroAmount);

    let numerator = (reserve_in as u128)
        .checked_mul(amount_out as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let denominator = (reserve_out as u128)
        .checked_sub(amount_out as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let amount_in_after_fee = (numerator - 1) / denominator + 1;

    let fee_multiplier = (FEE_DENOMINATOR as u128)
        .checked_sub(fee_tier as u128)
        .ok_or(ErrorCode::MathOverflow)?;

    let amount_in = mul_div_up(
        amount_in_after_fee,
        FEE_DENOMINATOR as u128,
        fee_multiplier,
    )? as u64;

    let fee = amount_in.checked_sub(amount_in_after_fee as u64).ok_or(ErrorCode::MathOverflow)?;

    let protocol_fee = if protocol_fee_fraction > 0 {
        mul_div_down(
            fee as u128,
            protocol_fee_fraction as u128,
            FEE_DENOMINATOR as u128,
        )? as u64
    } else {
        0
    };

    Ok((amount_in, protocol_fee))
}

