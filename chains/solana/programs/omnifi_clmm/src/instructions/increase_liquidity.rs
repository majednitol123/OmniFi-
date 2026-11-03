use crate::errors::ClmmError;
use crate::math::full_math::U256;
use crate::math::sqrt_price_math::{get_amount_0_delta, get_amount_1_delta};
use crate::math::tick_math::get_sqrt_price_at_tick;
use crate::state::{PoolState, PositionState, TickArray};
use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

#[derive(Accounts)]
pub struct ModifyLiquidity<'info> {
    #[account(
        mut,
        has_one = token_vault_0,
        has_one = token_vault_1
    )]
    pub pool_state: Account<'info, PoolState>,

    #[account(
        mut,
        constraint = position.pool == pool_state.key(),
        has_one = owner
    )]
    pub position: Account<'info, PositionState>,

    /// CHECK: Validated against pool.config
    pub config: UncheckedAccount<'info>,

    #[account(mut)]
    pub token_vault_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub token_vault_1: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_0: Account<'info, TokenAccount>,

    #[account(mut)]
    pub user_token_1: Account<'info, TokenAccount>,

    pub owner: Signer<'info>,
    pub token_program: Program<'info, Token>,
    // Remaining accounts: tick_array_lower (AccountInfo), and optionally tick_array_upper if different
}

/// Helper to calculate fee growth inside a range
pub fn compute_fee_growth_inside(
    tick_lower: i32,
    tick_upper: i32,
    current_tick: i32,
    fee_growth_global: u128,
    tick_lower_outside: u128,
    tick_upper_outside: u128,
) -> u128 {
    let fee_growth_below = if current_tick >= tick_lower {
        tick_lower_outside
    } else {
        fee_growth_global.wrapping_sub(tick_lower_outside)
    };

    let fee_growth_above = if current_tick < tick_upper {
        tick_upper_outside
    } else {
        fee_growth_global.wrapping_sub(tick_upper_outside)
    };

    fee_growth_global
        .wrapping_sub(fee_growth_below)
        .wrapping_sub(fee_growth_above)
}

pub fn process_increase_liquidity(
    ctx: Context<ModifyLiquidity>,
    liquidity_delta: u128,
    amount_0_max: u64,
    amount_1_max: u64,
) -> Result<()> {
    require!(!ctx.accounts.pool_state.is_paused, ClmmError::PoolPaused);
    require!(liquidity_delta > 0, ClmmError::ZeroLiquidity);

    let tick_lower_idx = ctx.accounts.position.tick_lower_index;
    let tick_upper_idx = ctx.accounts.position.tick_upper_index;
    let tick_spacing = ctx.accounts.pool_state.tick_spacing;

    // Load tick arrays from remaining_accounts
    require!(
        !ctx.remaining_accounts.is_empty(),
        ClmmError::MissingAdjacentTickArray
    );

    let start_lower = TickArray::get_start_tick_index(tick_lower_idx, tick_spacing);
    let start_upper = TickArray::get_start_tick_index(tick_upper_idx, tick_spacing);

    let mut tick_array_lower_account = Box::new(TickArray::try_deserialize(&mut &ctx.remaining_accounts[0].data.borrow()[..])?);
    require!(
        tick_array_lower_account.pool == ctx.accounts.pool_state.key(),
        ClmmError::InvalidTickArrayPool
    );
    require!(
        tick_array_lower_account.start_tick_index == start_lower,
        ClmmError::InvalidStartTickIndex
    );

    let (mut tick_array_upper_account, same_array) = if start_lower == start_upper {
        (None, true)
    } else {
        require!(
            ctx.remaining_accounts.len() >= 2,
            ClmmError::MissingAdjacentTickArray
        );
        let upper_acc = Box::new(TickArray::try_deserialize(&mut &ctx.remaining_accounts[1].data.borrow()[..])?);
        require!(
            upper_acc.pool == ctx.accounts.pool_state.key(),
            ClmmError::InvalidTickArrayPool
        );
        require!(
            upper_acc.start_tick_index == start_upper,
            ClmmError::InvalidStartTickIndex
        );
        (Some(upper_acc), false)
    };

    let pool = &mut ctx.accounts.pool_state;
    let position = &mut ctx.accounts.position;

    // 1. Update fees owed on position before modifying liquidity
    let tick_lower_outside_0 = tick_array_lower_account.get_tick(tick_lower_idx, tick_spacing)?.fee_growth_outside_0;
    let tick_lower_outside_1 = tick_array_lower_account.get_tick(tick_lower_idx, tick_spacing)?.fee_growth_outside_1;

    let (tick_upper_outside_0, tick_upper_outside_1) = if same_array {
        let t = tick_array_lower_account.get_tick(tick_upper_idx, tick_spacing)?;
        (t.fee_growth_outside_0, t.fee_growth_outside_1)
    } else {
        let t = tick_array_upper_account.as_ref().unwrap().get_tick(tick_upper_idx, tick_spacing)?;
        (t.fee_growth_outside_0, t.fee_growth_outside_1)
    };

    let growth_inside_0 = compute_fee_growth_inside(
        tick_lower_idx,
        tick_upper_idx,
        pool.current_tick,
        pool.fee_growth_global_0_x64,
        tick_lower_outside_0,
        tick_upper_outside_0,
    );
    let growth_inside_1 = compute_fee_growth_inside(
        tick_lower_idx,
        tick_upper_idx,
        pool.current_tick,
        pool.fee_growth_global_1_x64,
        tick_lower_outside_1,
        tick_upper_outside_1,
    );

    if position.liquidity > 0 {
        let delta_0 = growth_inside_0.wrapping_sub(position.fee_growth_inside_0_last_x64);
        let delta_1 = growth_inside_1.wrapping_sub(position.fee_growth_inside_1_last_x64);

        let fee_0 = ((U256::from(position.liquidity) * U256::from(delta_0)) >> 64).as_u64();
        let fee_1 = ((U256::from(position.liquidity) * U256::from(delta_1)) >> 64).as_u64();

        position.tokens_owed_0 = position.tokens_owed_0.checked_add(fee_0).ok_or(ClmmError::MathOverflow)?;
        position.tokens_owed_1 = position.tokens_owed_1.checked_add(fee_1).ok_or(ClmmError::MathOverflow)?;
    }

    position.fee_growth_inside_0_last_x64 = growth_inside_0;
    position.fee_growth_inside_1_last_x64 = growth_inside_1;

    // 2. Compute required amounts
    let sqrt_lower = get_sqrt_price_at_tick(tick_lower_idx)?;
    let sqrt_upper = get_sqrt_price_at_tick(tick_upper_idx)?;
    let current_sqrt = pool.sqrt_price_x64;

    let (amount_0, amount_1) = if pool.current_tick < tick_lower_idx {
        (
            get_amount_0_delta(sqrt_lower, sqrt_upper, liquidity_delta, true)?,
            0u64,
        )
    } else if pool.current_tick >= tick_upper_idx {
        (
            0u64,
            get_amount_1_delta(sqrt_lower, sqrt_upper, liquidity_delta, true)?,
        )
    } else {
        // In range: requires both tokens and updates active pool liquidity
        pool.liquidity = pool.liquidity.checked_add(liquidity_delta).ok_or(ClmmError::MathOverflow)?;
        (
            get_amount_0_delta(current_sqrt, sqrt_upper, liquidity_delta, true)?,
            get_amount_1_delta(sqrt_lower, current_sqrt, liquidity_delta, true)?,
        )
    };

    require!(amount_0 <= amount_0_max, ClmmError::AmountExceedsMaximum);
    require!(amount_1 <= amount_1_max, ClmmError::AmountExceedsMaximum);

    // 3. Update ticks
    {
        let current_tick = pool.current_tick;
        let global_0 = pool.fee_growth_global_0_x64;
        let global_1 = pool.fee_growth_global_1_x64;

        let tick_lower = tick_array_lower_account.get_tick_mut(tick_lower_idx, tick_spacing)?;
        if !tick_lower.initialized {
            tick_lower.initialized = true;
            if current_tick >= tick_lower_idx {
                tick_lower.fee_growth_outside_0 = global_0;
                tick_lower.fee_growth_outside_1 = global_1;
            }
        }
        tick_lower.liquidity_gross = tick_lower.liquidity_gross.checked_add(liquidity_delta).ok_or(ClmmError::MathOverflow)?;
        tick_lower.liquidity_net = tick_lower.liquidity_net.checked_add(liquidity_delta as i128).ok_or(ClmmError::MathOverflow)?;
    }

    if same_array {
        let current_tick = pool.current_tick;
        let global_0 = pool.fee_growth_global_0_x64;
        let global_1 = pool.fee_growth_global_1_x64;

        let tick_upper = tick_array_lower_account.get_tick_mut(tick_upper_idx, tick_spacing)?;
        if !tick_upper.initialized {
            tick_upper.initialized = true;
            if current_tick >= tick_upper_idx {
                tick_upper.fee_growth_outside_0 = global_0;
                tick_upper.fee_growth_outside_1 = global_1;
            }
        }
        tick_upper.liquidity_gross = tick_upper.liquidity_gross.checked_add(liquidity_delta).ok_or(ClmmError::MathOverflow)?;
        tick_upper.liquidity_net = tick_upper.liquidity_net.checked_sub(liquidity_delta as i128).ok_or(ClmmError::MathOverflow)?;
    } else {
        let current_tick = pool.current_tick;
        let global_0 = pool.fee_growth_global_0_x64;
        let global_1 = pool.fee_growth_global_1_x64;

        let upper_acc = tick_array_upper_account.as_mut().unwrap();
        let tick_upper = upper_acc.get_tick_mut(tick_upper_idx, tick_spacing)?;
        if !tick_upper.initialized {
            tick_upper.initialized = true;
            if current_tick >= tick_upper_idx {
                tick_upper.fee_growth_outside_0 = global_0;
                tick_upper.fee_growth_outside_1 = global_1;
            }
        }
        tick_upper.liquidity_gross = tick_upper.liquidity_gross.checked_add(liquidity_delta).ok_or(ClmmError::MathOverflow)?;
        tick_upper.liquidity_net = tick_upper.liquidity_net.checked_sub(liquidity_delta as i128).ok_or(ClmmError::MathOverflow)?;
    }

    // Save modified tick arrays
    tick_array_lower_account.try_serialize(&mut &mut ctx.remaining_accounts[0].data.borrow_mut()[..])?;
    if let Some(upper) = tick_array_upper_account {
        upper.try_serialize(&mut &mut ctx.remaining_accounts[1].data.borrow_mut()[..])?;
    }

    position.liquidity = position.liquidity.checked_add(liquidity_delta).ok_or(ClmmError::MathOverflow)?;

    // 4. CPI transfers into pool vaults
    if amount_0 > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_0.to_account_info(),
            to: ctx.accounts.token_vault_0.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount_0)?;
    }

    if amount_1 > 0 {
        let cpi_accounts = Transfer {
            from: ctx.accounts.user_token_1.to_account_info(),
            to: ctx.accounts.token_vault_1.to_account_info(),
            authority: ctx.accounts.owner.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
        token::transfer(cpi_ctx, amount_1)?;
    }

    Ok(())
}
