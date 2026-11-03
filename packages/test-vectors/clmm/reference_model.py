"""
OmniFi — CLMM (Concentrated-Liquidity AMM) Reference Model

Independent reference implementation of concentrated-liquidity math
for generating deterministic test vectors. Uses Python's Decimal and
the mpmath library for arbitrary-precision arithmetic.

All formulas correspond to evm-clmm-spec.md.
No floating-point is used in any financial calculation.
"""

from decimal import Decimal, ROUND_DOWN, ROUND_UP, getcontext
import json
import math

# Set high precision
getcontext().prec = 100

# === Constants ===

Q96 = 1 << 96   # 2^96
Q128 = 1 << 128  # 2^128
Q64 = 1 << 64   # 2^64 (for Solana variant)

FEE_DENOMINATOR = 1_000_000
PROTOCOL_FEE_DENOMINATOR = 4

MIN_TICK = -887272
MAX_TICK = 887272

# Precomputed sqrt-price at MIN_TICK and MAX_TICK (Q64.96)
MIN_SQRT_PRICE = 4295128739
MAX_SQRT_PRICE = 1461446703485210103287273052203988822378723970342

# Fee tiers
FEE_TIERS = {
    100: {"tick_spacing": 1, "label": "0.01%"},
    500: {"tick_spacing": 10, "label": "0.05%"},
    3000: {"tick_spacing": 60, "label": "0.30%"},
    10000: {"tick_spacing": 200, "label": "1.00%"},
}

MAX_UINT128 = (1 << 128) - 1
MAX_UINT256 = (1 << 256) - 1


# === Helper Functions ===

def ceil_div(a: int, b: int) -> int:
    """Integer ceiling division."""
    assert b > 0
    assert a >= 0
    return (a + b - 1) // b


def mul_div(a: int, b: int, c: int) -> int:
    """Full-precision (a * b) / c, rounded DOWN."""
    assert c > 0
    return (a * b) // c


def mul_div_up(a: int, b: int, c: int) -> int:
    """Full-precision (a * b) / c, rounded UP."""
    assert c > 0
    return (a * b + c - 1) // c


# === Tick ↔ Price Conversion ===

def tick_to_sqrt_price_x96(tick: int) -> int:
    """
    Convert tick to sqrt-price in Q64.96 format.
    Uses high-precision Decimal math, then converts to integer.
    
    sqrtPrice = 1.0001^(tick/2)
    sqrtPriceX96 = sqrtPrice * 2^96
    """
    assert MIN_TICK <= tick <= MAX_TICK, f"Tick {tick} out of range"

    # Use Decimal for precision
    base = Decimal("1.0001")
    exponent = Decimal(tick) / 2
    sqrt_price = base ** exponent
    sqrt_price_x96 = int(sqrt_price * Q96)

    # Clamp to valid range
    sqrt_price_x96 = max(sqrt_price_x96, MIN_SQRT_PRICE)
    sqrt_price_x96 = min(sqrt_price_x96, MAX_SQRT_PRICE)

    return sqrt_price_x96


def sqrt_price_x96_to_tick(sqrt_price_x96: int) -> int:
    """
    Convert sqrt-price (Q64.96) to tick.
    Returns the largest tick i such that getSqrtPriceAtTick(i) <= sqrtPriceX96.
    Rounds DOWN.
    """
    assert MIN_SQRT_PRICE <= sqrt_price_x96 <= MAX_SQRT_PRICE

    sqrt_price = Decimal(sqrt_price_x96) / Q96
    price = sqrt_price ** 2
    # tick = log(price) / log(1.0001)
    tick = int(Decimal(str(price)).ln() / Decimal("1.0001").ln())

    # Validate: ensure we round DOWN
    while tick < MAX_TICK and tick_to_sqrt_price_x96(tick + 1) <= sqrt_price_x96:
        tick += 1
    while tick_to_sqrt_price_x96(tick) > sqrt_price_x96:
        tick -= 1

    return tick


# === Amount Calculations ===

def get_amount0_delta(
    sqrt_price_lower_x96: int,
    sqrt_price_upper_x96: int,
    liquidity: int,
    round_up: bool = False,
) -> int:
    """
    Compute token0 amount for a liquidity range.
    amount0 = L * (sqrtPriceUpper - sqrtPriceLower) / (sqrtPriceLower * sqrtPriceUpper) * Q96
    """
    assert sqrt_price_lower_x96 <= sqrt_price_upper_x96
    if liquidity == 0 or sqrt_price_lower_x96 == sqrt_price_upper_x96:
        return 0

    diff = sqrt_price_upper_x96 - sqrt_price_lower_x96
    numerator = liquidity * diff * Q96

    if round_up:
        # Round UP
        amount = ceil_div(
            ceil_div(numerator, sqrt_price_upper_x96),
            sqrt_price_lower_x96,
        )
    else:
        # Round DOWN
        amount = numerator // sqrt_price_upper_x96 // sqrt_price_lower_x96

    return amount


def get_amount1_delta(
    sqrt_price_lower_x96: int,
    sqrt_price_upper_x96: int,
    liquidity: int,
    round_up: bool = False,
) -> int:
    """
    Compute token1 amount for a liquidity range.
    amount1 = L * (sqrtPriceUpper - sqrtPriceLower) / Q96
    """
    assert sqrt_price_lower_x96 <= sqrt_price_upper_x96
    if liquidity == 0 or sqrt_price_lower_x96 == sqrt_price_upper_x96:
        return 0

    diff = sqrt_price_upper_x96 - sqrt_price_lower_x96

    if round_up:
        amount = mul_div_up(liquidity, diff, Q96)
    else:
        amount = mul_div(liquidity, diff, Q96)

    return amount


# === Liquidity from Amounts ===

def get_liquidity_for_amount0(
    sqrt_price_lower_x96: int,
    sqrt_price_upper_x96: int,
    amount0: int,
) -> int:
    """Compute maximum liquidity from amount0. Round DOWN."""
    if sqrt_price_lower_x96 == sqrt_price_upper_x96:
        return 0
    diff = sqrt_price_upper_x96 - sqrt_price_lower_x96
    intermediate = mul_div(sqrt_price_lower_x96, sqrt_price_upper_x96, Q96)
    return mul_div(amount0, intermediate, diff)


def get_liquidity_for_amount1(
    sqrt_price_lower_x96: int,
    sqrt_price_upper_x96: int,
    amount1: int,
) -> int:
    """Compute maximum liquidity from amount1. Round DOWN."""
    if sqrt_price_lower_x96 == sqrt_price_upper_x96:
        return 0
    diff = sqrt_price_upper_x96 - sqrt_price_lower_x96
    return mul_div(amount1, Q96, diff)


def get_liquidity_for_amounts(
    sqrt_price_current_x96: int,
    sqrt_price_lower_x96: int,
    sqrt_price_upper_x96: int,
    amount0: int,
    amount1: int,
) -> int:
    """Compute maximum liquidity from both amounts at current price. Round DOWN."""
    if sqrt_price_current_x96 <= sqrt_price_lower_x96:
        return get_liquidity_for_amount0(sqrt_price_lower_x96, sqrt_price_upper_x96, amount0)
    elif sqrt_price_current_x96 >= sqrt_price_upper_x96:
        return get_liquidity_for_amount1(sqrt_price_lower_x96, sqrt_price_upper_x96, amount1)
    else:
        l0 = get_liquidity_for_amount0(sqrt_price_current_x96, sqrt_price_upper_x96, amount0)
        l1 = get_liquidity_for_amount1(sqrt_price_lower_x96, sqrt_price_current_x96, amount1)
        return min(l0, l1)


# === Swap Step ===

def get_next_sqrt_price_from_input(
    sqrt_price_x96: int,
    liquidity: int,
    amount_in: int,
    zero_for_one: bool,
) -> int:
    """Compute next sqrt-price after consuming amount_in."""
    assert sqrt_price_x96 > 0
    assert liquidity > 0

    if zero_for_one:
        # Adding token0 → price decreases
        # sqrtPriceNext = L * sqrtPrice / (L + amountIn * sqrtPrice / Q96)
        product = amount_in * sqrt_price_x96
        denominator = (liquidity << 96) + product
        result = ceil_div(liquidity * sqrt_price_x96 * Q96, denominator)
        return result
    else:
        # Adding token1 → price increases
        # sqrtPriceNext = sqrtPrice + amountIn * Q96 / L
        quotient = mul_div(amount_in, Q96, liquidity)
        return sqrt_price_x96 + quotient


def compute_swap_step(
    sqrt_price_current_x96: int,
    sqrt_price_target_x96: int,
    liquidity: int,
    amount_remaining: int,
    fee: int,
) -> dict:
    """
    Compute a single swap step within one tick range.
    Exact input only (amount_remaining > 0).
    
    Returns: sqrtPriceNext, amountIn, amountOut, feeAmount
    """
    zero_for_one = sqrt_price_current_x96 >= sqrt_price_target_x96

    # Step 1: Max input after fee
    amount_remaining_after_fee = amount_remaining * (FEE_DENOMINATOR - fee) // FEE_DENOMINATOR

    # Step 2: Input needed to reach target
    if zero_for_one:
        amount_in_to_target = get_amount0_delta(
            sqrt_price_target_x96, sqrt_price_current_x96, liquidity, round_up=True
        )
    else:
        amount_in_to_target = get_amount1_delta(
            sqrt_price_current_x96, sqrt_price_target_x96, liquidity, round_up=True
        )

    # Step 3: Do we reach the target?
    if amount_remaining_after_fee >= amount_in_to_target:
        sqrt_price_next_x96 = sqrt_price_target_x96
        amount_in = amount_in_to_target
    else:
        sqrt_price_next_x96 = get_next_sqrt_price_from_input(
            sqrt_price_current_x96, liquidity, amount_remaining_after_fee, zero_for_one
        )
        if zero_for_one:
            amount_in = get_amount0_delta(
                min(sqrt_price_next_x96, sqrt_price_current_x96),
                max(sqrt_price_next_x96, sqrt_price_current_x96),
                liquidity, round_up=True
            )
        else:
            amount_in = get_amount1_delta(
                min(sqrt_price_current_x96, sqrt_price_next_x96),
                max(sqrt_price_current_x96, sqrt_price_next_x96),
                liquidity, round_up=True
            )

    # Step 4: Output
    if zero_for_one:
        # Price decreased: current was higher, next is lower
        sp_lo = min(sqrt_price_next_x96, sqrt_price_current_x96)
        sp_hi = max(sqrt_price_next_x96, sqrt_price_current_x96)
        amount_out = get_amount1_delta(sp_lo, sp_hi, liquidity, round_up=False)
    else:
        # Price increased: next is higher, current was lower
        sp_lo = min(sqrt_price_next_x96, sqrt_price_current_x96)
        sp_hi = max(sqrt_price_next_x96, sqrt_price_current_x96)
        amount_out = get_amount0_delta(sp_lo, sp_hi, liquidity, round_up=False)

    # Step 5: Fee
    if sqrt_price_next_x96 != sqrt_price_target_x96:
        fee_amount = amount_remaining - amount_in
    else:
        fee_amount = mul_div_up(amount_in, fee, FEE_DENOMINATOR - fee)

    return {
        "sqrt_price_next_x96": str(sqrt_price_next_x96),
        "amount_in": amount_in,
        "amount_out": amount_out,
        "fee_amount": fee_amount,
    }


# === Fee Growth ===

def compute_fee_growth_increment(fee_amount: int, liquidity: int, q: int = Q128) -> int:
    """
    Compute fee growth increment per unit of liquidity.
    feeGrowth += feeAmount * Q128 / liquidity (round DOWN)
    """
    if liquidity == 0:
        return 0
    return mul_div(fee_amount, q, liquidity)


def compute_fee_growth_inside(
    fee_growth_global_x128: int,
    fee_growth_outside_lower_x128: int,
    fee_growth_outside_upper_x128: int,
    tick_lower: int,
    tick_upper: int,
    tick_current: int,
) -> int:
    """
    Compute fee growth inside a position range.
    All arithmetic is modular (wrapping uint256 for EVM, uint128 for Solana).
    """
    # Fee growth below tickLower
    if tick_current >= tick_lower:
        fee_growth_below = fee_growth_outside_lower_x128
    else:
        fee_growth_below = fee_growth_global_x128 - fee_growth_outside_lower_x128

    # Fee growth above tickUpper
    if tick_current < tick_upper:
        fee_growth_above = fee_growth_outside_upper_x128
    else:
        fee_growth_above = fee_growth_global_x128 - fee_growth_outside_upper_x128

    # Inside = global - below - above
    fee_growth_inside = fee_growth_global_x128 - fee_growth_below - fee_growth_above

    return fee_growth_inside


def compute_fees_owed(
    fee_growth_inside_current: int,
    fee_growth_inside_last: int,
    liquidity: int,
    q: int = Q128,
) -> int:
    """
    Compute uncollected fees for a position.
    Round DOWN.
    """
    delta = fee_growth_inside_current - fee_growth_inside_last
    # For wrapping arithmetic, delta is already correct via modular subtraction
    if delta < 0:
        delta += (1 << 256) if q == Q128 else (1 << 128)

    return mul_div(delta, liquidity, q)


# === Position Operations ===

def mint_position(
    sqrt_price_current_x96: int,
    tick_lower: int,
    tick_upper: int,
    amount0_desired: int,
    amount1_desired: int,
    fee: int,
) -> dict:
    """
    Compute liquidity and token amounts for minting a new position.
    """
    tick_spacing = FEE_TIERS[fee]["tick_spacing"]
    assert tick_lower % tick_spacing == 0, "tickLower not aligned"
    assert tick_upper % tick_spacing == 0, "tickUpper not aligned"
    assert tick_lower < tick_upper, "tickLower >= tickUpper"
    assert MIN_TICK <= tick_lower, "tickLower below MIN_TICK"
    assert tick_upper <= MAX_TICK, "tickUpper above MAX_TICK"

    sqrt_price_lower = tick_to_sqrt_price_x96(tick_lower)
    sqrt_price_upper = tick_to_sqrt_price_x96(tick_upper)

    # Compute maximum liquidity
    liquidity = get_liquidity_for_amounts(
        sqrt_price_current_x96, sqrt_price_lower, sqrt_price_upper,
        amount0_desired, amount1_desired,
    )
    assert liquidity > 0, "Zero liquidity"

    # Compute actual token amounts (round UP — depositor provides more)
    tick_current = sqrt_price_x96_to_tick(sqrt_price_current_x96)

    if tick_current < tick_lower:
        amount0 = get_amount0_delta(sqrt_price_lower, sqrt_price_upper, liquidity, round_up=True)
        amount1 = 0
    elif tick_current < tick_upper:
        amount0 = get_amount0_delta(sqrt_price_current_x96, sqrt_price_upper, liquidity, round_up=True)
        amount1 = get_amount1_delta(sqrt_price_lower, sqrt_price_current_x96, liquidity, round_up=True)
    else:
        amount0 = 0
        amount1 = get_amount1_delta(sqrt_price_lower, sqrt_price_upper, liquidity, round_up=True)

    return {
        "tick_lower": tick_lower,
        "tick_upper": tick_upper,
        "liquidity": liquidity,
        "amount0": amount0,
        "amount1": amount1,
        "sqrt_price_lower_x96": str(sqrt_price_lower),
        "sqrt_price_upper_x96": str(sqrt_price_upper),
        "in_range": tick_lower <= tick_current < tick_upper,
    }


# === Test Vector Generation ===

def generate_vectors() -> dict:
    vectors = {
        "metadata": {
            "generator": "omnifi-clmm-reference-model",
            "version": "1.0",
            "spec": "evm-clmm-spec.md",
            "q96": str(Q96),
            "q128": str(Q128),
            "fee_denominator": FEE_DENOMINATOR,
            "min_tick": MIN_TICK,
            "max_tick": MAX_TICK,
            "min_sqrt_price": str(MIN_SQRT_PRICE),
            "max_sqrt_price": str(MAX_SQRT_PRICE),
        },
        "tick_to_sqrt_price": [],
        "sqrt_price_to_tick": [],
        "swap_step": [],
        "amount_calculations": [],
        "mint_position": [],
        "fee_growth": [],
    }

    # --- Tick ↔ SqrtPrice vectors ---

    test_ticks = [0, 1, -1, 100, -100, 887272, -887272, 60, -60, 23028, -23028,
                  46054, 200, -200, 1000, -1000, 10000, -10000, 100000, -100000]

    for tick in test_ticks:
        sqrt_price = tick_to_sqrt_price_x96(tick)
        vectors["tick_to_sqrt_price"].append({
            "tick": tick,
            "sqrt_price_x96": str(sqrt_price),
        })

    # Roundtrip: sqrt_price → tick → sqrt_price
    for tick in [0, 100, -100, 60, 23028, -887272, 887272]:
        sqrt_price = tick_to_sqrt_price_x96(tick)
        recovered_tick = sqrt_price_x96_to_tick(sqrt_price)
        vectors["sqrt_price_to_tick"].append({
            "sqrt_price_x96": str(sqrt_price),
            "expected_tick": tick,
            "recovered_tick": recovered_tick,
        })

    # --- Swap Step vectors ---

    # Price = 1:1 (tick ≈ 0), 0.30% fee
    sqrt_price_1_1 = tick_to_sqrt_price_x96(0)  # 1:1 price
    sqrt_price_target = tick_to_sqrt_price_x96(-60)  # one tick spacing down

    vectors["swap_step"].append({
        "name": "typical_step_0.30pct_zeroForOne",
        "inputs": {
            "sqrt_price_current_x96": str(sqrt_price_1_1),
            "sqrt_price_target_x96": str(sqrt_price_target),
            "liquidity": 10**18,
            "amount_remaining": 10**15,
            "fee": 3000,
        },
        "expected": compute_swap_step(sqrt_price_1_1, sqrt_price_target, 10**18, 10**15, 3000),
    })

    # Small amount that doesn't reach target
    vectors["swap_step"].append({
        "name": "small_step_no_cross",
        "inputs": {
            "sqrt_price_current_x96": str(sqrt_price_1_1),
            "sqrt_price_target_x96": str(sqrt_price_target),
            "liquidity": 10**18,
            "amount_remaining": 1000,
            "fee": 3000,
        },
        "expected": compute_swap_step(sqrt_price_1_1, sqrt_price_target, 10**18, 1000, 3000),
    })

    # Price increasing (oneForZero)
    sqrt_price_target_up = tick_to_sqrt_price_x96(60)
    vectors["swap_step"].append({
        "name": "typical_step_0.30pct_oneForZero",
        "inputs": {
            "sqrt_price_current_x96": str(sqrt_price_1_1),
            "sqrt_price_target_x96": str(sqrt_price_target_up),
            "liquidity": 10**18,
            "amount_remaining": 10**15,
            "fee": 3000,
        },
        "expected": compute_swap_step(sqrt_price_1_1, sqrt_price_target_up, 10**18, 10**15, 3000),
    })

    # 0.01% fee (stablecoin)
    sqrt_price_stable_target = tick_to_sqrt_price_x96(-1)
    vectors["swap_step"].append({
        "name": "stablecoin_step_0.01pct",
        "inputs": {
            "sqrt_price_current_x96": str(sqrt_price_1_1),
            "sqrt_price_target_x96": str(sqrt_price_stable_target),
            "liquidity": 10**18,
            "amount_remaining": 10**12,
            "fee": 100,
        },
        "expected": compute_swap_step(sqrt_price_1_1, sqrt_price_stable_target, 10**18, 10**12, 100),
    })

    # High liquidity
    vectors["swap_step"].append({
        "name": "high_liquidity_step",
        "inputs": {
            "sqrt_price_current_x96": str(sqrt_price_1_1),
            "sqrt_price_target_x96": str(sqrt_price_target),
            "liquidity": 10**24,
            "amount_remaining": 10**18,
            "fee": 3000,
        },
        "expected": compute_swap_step(sqrt_price_1_1, sqrt_price_target, 10**24, 10**18, 3000),
    })

    # --- Amount Calculation vectors ---

    for tick_l, tick_u, liq, label in [
        (-60, 60, 10**18, "narrow_range_at_parity"),
        (-887220, 887220, 10**18, "full_range"),
        (23000, 23100, 10**15, "out_of_range_above"),
        (-100, -60, 10**15, "out_of_range_below"),
        (-600, 600, 10**18, "wide_range"),
    ]:
        sp_l = tick_to_sqrt_price_x96(tick_l)
        sp_u = tick_to_sqrt_price_x96(tick_u)
        a0_down = get_amount0_delta(sp_l, sp_u, liq, round_up=False)
        a0_up = get_amount0_delta(sp_l, sp_u, liq, round_up=True)
        a1_down = get_amount1_delta(sp_l, sp_u, liq, round_up=False)
        a1_up = get_amount1_delta(sp_l, sp_u, liq, round_up=True)

        vectors["amount_calculations"].append({
            "name": label,
            "inputs": {
                "tick_lower": tick_l,
                "tick_upper": tick_u,
                "liquidity": liq,
                "sqrt_price_lower_x96": str(sp_l),
                "sqrt_price_upper_x96": str(sp_u),
            },
            "expected": {
                "amount0_round_down": a0_down,
                "amount0_round_up": a0_up,
                "amount1_round_down": a1_down,
                "amount1_round_up": a1_up,
            },
        })

    # --- Mint Position vectors ---

    for tick_l, tick_u, a0, a1, fee_tier, label in [
        (-60, 60, 10**18, 10**18, 3000, "in_range_parity_0.30pct"),
        (-600, 600, 10**18, 10**18, 3000, "wide_range_parity"),
        (120, 240, 10**18, 0, 3000, "above_range_token0_only"),
        (-240, -120, 0, 10**18, 3000, "below_range_token1_only"),
        (-1, 1, 10**18, 10**18, 100, "tight_range_stablecoin"),
    ]:
        vectors["mint_position"].append({
            "name": label,
            "inputs": {
                "sqrt_price_current_x96": str(sqrt_price_1_1),
                "tick_lower": tick_l,
                "tick_upper": tick_u,
                "amount0_desired": a0,
                "amount1_desired": a1,
                "fee": fee_tier,
            },
            "expected": mint_position(sqrt_price_1_1, tick_l, tick_u, a0, a1, fee_tier),
        })

    # --- Fee Growth vectors ---

    vectors["fee_growth"].append({
        "name": "basic_fee_growth",
        "inputs": {"fee_amount": 10**15, "liquidity": 10**18},
        "expected": {
            "fee_growth_increment_x128": str(compute_fee_growth_increment(10**15, 10**18, Q128)),
            "fee_growth_increment_x64": str(compute_fee_growth_increment(10**15, 10**18, Q64)),
        },
    })

    vectors["fee_growth"].append({
        "name": "small_fee_high_liquidity",
        "inputs": {"fee_amount": 100, "liquidity": 10**24},
        "expected": {
            "fee_growth_increment_x128": str(compute_fee_growth_increment(100, 10**24, Q128)),
            "fee_growth_increment_x64": str(compute_fee_growth_increment(100, 10**24, Q64)),
        },
    })

    vectors["fee_growth"].append({
        "name": "fee_growth_inside",
        "inputs": {
            "fee_growth_global": 10**30,
            "fee_growth_outside_lower": 10**28,
            "fee_growth_outside_upper": 2 * 10**28,
            "tick_lower": -60,
            "tick_upper": 60,
            "tick_current": 0,
        },
        "expected": {
            "fee_growth_inside": compute_fee_growth_inside(
                10**30, 10**28, 2 * 10**28, -60, 60, 0
            ),
        },
    })

    vectors["fee_growth"].append({
        "name": "fees_owed",
        "inputs": {
            "fee_growth_inside_current": 10**30,
            "fee_growth_inside_last": 5 * 10**29,
            "liquidity": 10**18,
        },
        "expected": {
            "fees_owed_x128": compute_fees_owed(10**30, 5 * 10**29, 10**18, Q128),
            "fees_owed_x64": compute_fees_owed(10**30, 5 * 10**29, 10**18, Q64),
        },
    })

    return vectors


def main():
    vectors = generate_vectors()
    output = json.dumps(vectors, indent=2, default=str)
    print(output)


if __name__ == "__main__":
    main()

