use crate::constants::{
    FEE_DENOMINATOR, MAX_SQRT_PRICE, MIN_SQRT_PRICE, POOL_AUTHORITY_SEED, TICK_ARRAY_SIZE,
};
use crate::errors::ClmmError;
use crate::math::full_math::mul_div_down;
use crate::math::swap_math::compute_swap_step;
use crate::math::tick_math::{get_sqrt_price_at_tick, get_tick_at_sqrt_price};
use crate::state::{GlobalConfig, PoolState, TickArray};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct Swap<'info> {
    pub config: Account<'info, GlobalConfig>,

    #[account(
        mut,
        has_one = token_vault_0,
        has_one = token_vault_1
    )]
    pub pool_state: Account<'info, PoolState>,

    /// CHECK: Pool authority PDA for CPI signing
    #[account(
        seeds = [POOL_AUTHORITY_SEED, pool_state.key().as_ref()],
        bump = pool_state.authority_bump
    )]
    pub pool_authority: UncheckedAccount<'info>,

    #[account(mut)]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_source: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_destination: Account<'info, TokenAccount>,

    pub user: Signer<'info>,
    pub token_program: Program<'info, Token>,
    // Remaining accounts: up to 3 TickArray accounts in traversal order
}

pub fn process_swap(
    ctx: Context<Swap>,
    amount: u64,
    other_amount_threshold: u64,
    sqrt_price_limit_x64: u128,
    is_exact_input: bool,
    zero_for_one: bool,
) -> Result<()> {
    require!(!ctx.accounts.config.emergency_paused, ClmmError::EmergencyPaused);
    require!(!ctx.accounts.pool_state.is_paused, ClmmError::PoolPaused);
    require!(amount > 0, ClmmError::ZeroAmount);

    let pool = &mut ctx.accounts.pool_state;

    // Validate price limit
    if zero_for_one {
        require!(
            sqrt_price_limit_x64 < pool.sqrt_price_x64 && sqrt_price_limit_x64 >= MIN_SQRT_PRICE,
            ClmmError::InvalidPriceLimit
        );
    } else {
        require!(
            sqrt_price_limit_x64 > pool.sqrt_price_x64 && sqrt_price_limit_x64 <= MAX_SQRT_PRICE,
            ClmmError::InvalidPriceLimit
        );
    }

    require!(
        !ctx.remaining_accounts.is_empty(),
        ClmmError::MissingAdjacentTickArray
    );

    // Parse tick arrays from remaining accounts
    let mut tick_arrays: Vec<Box<TickArray>> = Vec::new();
    for acc_info in ctx.remaining_accounts.iter() {
        let arr = Box::new(TickArray::try_deserialize(&mut &acc_info.data.borrow()[..])?);
        require!(arr.pool == pool.key(), ClmmError::InvalidTickArrayPool);
        tick_arrays.push(arr);
    }

    // Verify first tick array covers current tick
    let first_start = TickArray::get_start_tick_index(pool.current_tick, pool.tick_spacing);
    require!(
        tick_arrays[0].start_tick_index == first_start,
        ClmmError::InvalidStartTickIndex
    );

    // Verify contiguity and correct sequencing of subsequent tick arrays in trade direction
    let ticks_per_array = (TICK_ARRAY_SIZE as i32)
        .checked_mul(pool.tick_spacing as i32)
        .ok_or(ClmmError::MathOverflow)?;
    for i in 1..tick_arrays.len() {
        let expected_start = if zero_for_one {
            tick_arrays[i - 1]
                .start_tick_index
                .checked_sub(ticks_per_array)
                .ok_or(ClmmError::MathOverflow)?
        } else {
            tick_arrays[i - 1]
                .start_tick_index
                .checked_add(ticks_per_array)
                .ok_or(ClmmError::MathOverflow)?
        };
        require!(
            tick_arrays[i].start_tick_index == expected_start,
            ClmmError::InvalidTickArraySequence
        );
    }

    let mut current_array_idx = 0usize;
    let mut amount_remaining = amount;
    let mut total_amount_in = 0u64;
    let mut total_amount_out = 0u64;
    let mut total_fee_amount = 0u64;

    while amount_remaining > 0 && pool.sqrt_price_x64 != sqrt_price_limit_x64 {
        if current_array_idx >= tick_arrays.len() {
            // Reached boundary with no more tick arrays provided: clean boundary stop
            break;
        }

        let current_array = &mut tick_arrays[current_array_idx];
        let tick_spacing = pool.tick_spacing as i32;

        // Search for next initialized tick in current array
        let current_tick = pool.current_tick;
        let mut next_tick_idx: Option<i32> = None;

        if zero_for_one {
            // Search downwards
            let start_offset = if current_tick >= current_array.start_tick_index {
                let diff = current_tick - current_array.start_tick_index;
                (diff / tick_spacing).min(TICK_ARRAY_SIZE as i32 - 1)
            } else {
                -1
            };

            for offset in (0..=start_offset).rev() {
                let tick_i = current_array.start_tick_index + offset * tick_spacing;
                if tick_i < current_tick && current_array.ticks[offset as usize].initialized {
                    next_tick_idx = Some(tick_i);
                    break;
                }
            }
        } else {
            // Search upwards
            let start_offset = if current_tick >= current_array.start_tick_index {
                let diff = current_tick - current_array.start_tick_index;
                ((diff / tick_spacing) + 1).max(0)
            } else {
                0
            };

            for offset in start_offset..(TICK_ARRAY_SIZE as i32) {
                let tick_i = current_array.start_tick_index + offset * tick_spacing;
                if tick_i > current_tick && current_array.ticks[offset as usize].initialized {
                    next_tick_idx = Some(tick_i);
                    break;
                }
            }
        }

        // Determine target sqrt price
        let (target_sqrt_price, is_tick_crossing, crossed_tick_idx) = match next_tick_idx {
            Some(tick_idx) => {
                let p = get_sqrt_price_at_tick(tick_idx)?;
                if zero_for_one {
                    if p < sqrt_price_limit_x64 {
                        (sqrt_price_limit_x64, false, 0)
                    } else {
                        (p, true, tick_idx)
                    }
                } else if p > sqrt_price_limit_x64 {
                    (sqrt_price_limit_x64, false, 0)
                } else {
                    (p, true, tick_idx)
                }
            }
            None => {
                // No initialized tick in this array; target is array boundary
                let boundary_tick = if zero_for_one {
                    current_array.start_tick_index
                } else {
                    current_array.start_tick_index + (TICK_ARRAY_SIZE as i32) * tick_spacing
                };
                let p = get_sqrt_price_at_tick(boundary_tick)?;
                if zero_for_one {
                    (p.max(sqrt_price_limit_x64), false, 0)
                } else {
                    (p.min(sqrt_price_limit_x64), false, 0)
                }
            }
        };

        let step = compute_swap_step(
            pool.sqrt_price_x64,
            target_sqrt_price,
            pool.liquidity,
            amount_remaining,
            pool.fee_tier,
            is_exact_input,
            zero_for_one,
        )?;

        pool.sqrt_price_x64 = step.sqrt_price_next_x64;
        pool.current_tick = get_tick_at_sqrt_price(step.sqrt_price_next_x64)?;

        total_amount_in = total_amount_in
            .checked_add(step.amount_in)
            .ok_or(ClmmError::MathOverflow)?;
        total_amount_out = total_amount_out
            .checked_add(step.amount_out)
            .ok_or(ClmmError::MathOverflow)?;
        total_fee_amount = total_fee_amount
            .checked_add(step.fee_amount)
            .ok_or(ClmmError::MathOverflow)?;

        if is_exact_input {
            let step_used = step
                .amount_in
                .checked_add(step.fee_amount)
                .ok_or(ClmmError::MathOverflow)?;
            amount_remaining = amount_remaining.saturating_sub(step_used);
        } else {
            amount_remaining = amount_remaining.saturating_sub(step.amount_out);
        }

        // Global fee growth accumulation
        if pool.liquidity > 0 && step.fee_amount > 0 {
            let fee_growth_delta = mul_div_down(
                step.fee_amount as u128,
                1u128 << 64,
                pool.liquidity,
            )?;
            if zero_for_one {
                pool.fee_growth_global_0_x64 = pool.fee_growth_global_0_x64.wrapping_add(fee_growth_delta);
            } else {
                pool.fee_growth_global_1_x64 = pool.fee_growth_global_1_x64.wrapping_add(fee_growth_delta);
            }
        }

        // Check if step reached target price
        if pool.sqrt_price_x64 == target_sqrt_price {
            if is_tick_crossing {
                let tick = current_array.get_tick_mut(crossed_tick_idx, pool.tick_spacing)?;
                // Invert fee growth outside
                tick.fee_growth_outside_0 = pool
                    .fee_growth_global_0_x64
                    .wrapping_sub(tick.fee_growth_outside_0);
                tick.fee_growth_outside_1 = pool
                    .fee_growth_global_1_x64
                    .wrapping_sub(tick.fee_growth_outside_1);

                // Update active liquidity
                if zero_for_one {
                    let net = tick.liquidity_net;
                    if net < 0 {
                        pool.liquidity = pool.liquidity.checked_add((-net) as u128).ok_or(ClmmError::MathOverflow)?;
                    } else {
                        pool.liquidity = pool.liquidity.checked_sub(net as u128).ok_or(ClmmError::MathOverflow)?;
                    }
                } else {
                    let net = tick.liquidity_net;
                    if net >= 0 {
                        pool.liquidity = pool.liquidity.checked_add(net as u128).ok_or(ClmmError::MathOverflow)?;
                    } else {
                        pool.liquidity = pool.liquidity.checked_sub((-net) as u128).ok_or(ClmmError::MathOverflow)?;
                    }
                }
            } else {
                // Array boundary reached: advance to next array
                current_array_idx += 1;
            }
        }
    }

    // Accumulate protocol fees
    let protocol_fee = if ctx.accounts.config.default_protocol_fee_fraction > 0 && total_fee_amount > 0 {
        mul_div_down(
            total_fee_amount as u128,
            ctx.accounts.config.default_protocol_fee_fraction as u128,
            FEE_DENOMINATOR as u128,
        )? as u64
    } else {
        0
    };

    if zero_for_one {
        pool.protocol_fees_token_0 = pool.protocol_fees_token_0.checked_add(protocol_fee).ok_or(ClmmError::MathOverflow)?;
    } else {
        pool.protocol_fees_token_1 = pool.protocol_fees_token_1.checked_add(protocol_fee).ok_or(ClmmError::MathOverflow)?;
    }

    // Slippage & exact-output fulfillment enforcement
    if is_exact_input {
        require!(
            total_amount_out >= other_amount_threshold,
            ClmmError::SlippageExceeded
        );
    } else {
        // Exact-output swaps must fully satisfy requested output amount
        require!(
            amount_remaining == 0,
            ClmmError::SlippageExceeded
        );
        let total_in_with_fee = total_amount_in
            .checked_add(total_fee_amount)
            .ok_or(ClmmError::MathOverflow)?;
        require!(
            total_in_with_fee <= other_amount_threshold,
            ClmmError::SlippageExceeded
        );
    }

    // Save modified tick arrays
    for (i, arr) in tick_arrays.iter().enumerate() {
        arr.try_serialize(&mut &mut ctx.remaining_accounts[i].data.borrow_mut()[..])?;
    }

    // Token transfers: input from user to vault, output from vault to user
    let (vault_in, vault_out) = if zero_for_one {
        (
            ctx.accounts.token_vault_0.to_account_info(),
            ctx.accounts.token_vault_1.to_account_info(),
        )
    } else {
        (
            ctx.accounts.token_vault_1.to_account_info(),
            ctx.accounts.token_vault_0.to_account_info(),
        )
    };

    let total_in = total_amount_in
        .checked_add(total_fee_amount)
        .ok_or(ClmmError::MathOverflow)?;

    // Pull input
    let cpi_in = Transfer {
        from: ctx.accounts.user_source.to_account_info(),
        to: vault_in,
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_in),
        total_in,
    )?;

    // Push output signed by pool authority
    let pool_key = pool.key();
    let authority_seeds = &[
        POOL_AUTHORITY_SEED,
        pool_key.as_ref(),
        &[pool.authority_bump],
    ];
    let signer = &[&authority_seeds[..]];

    let cpi_out = Transfer {
        from: vault_out,
        to: ctx.accounts.user_destination.to_account_info(),
        authority: ctx.accounts.pool_authority.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_out,
            signer,
        ),
        total_amount_out,
    )?;

    Ok(())
}
