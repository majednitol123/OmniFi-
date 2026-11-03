"""
OmniFi — Solana CLMM Reference Model

Solana-specific CLMM reference implementation using Q32.64 / Q64.64
fixed-point arithmetic (u128) instead of EVM's Q64.96 / Q128.128 (u256).

All formulas correspond to solana-clmm-spec.md.
Shares core math with EVM CLMM but adapted for u128 bounds.
"""

from decimal import Decimal, ROUND_DOWN, ROUND_UP, getcontext
import json
import math

getcontext().prec = 100

# === Constants (Solana-specific) ===

Q64 = 1 << 64    # 2^64 — fee growth scaling
Q32_64 = 1 << 64  # Q32.64 sqrt-price format (u128)

FEE_DENOMINATOR = 1_000_000
PROTOCOL_FEE_DENOMINATOR = 4

MIN_TICK = -887272
MAX_TICK = 887272

TICK_ARRAY_SIZE = 88  # ticks per array

# Fee tiers (same as EVM)
FEE_TIERS = {
    100: {"tick_spacing": 1, "label": "0.01%"},
    500: {"tick_spacing": 10, "label": "0.05%"},
    3000: {"tick_spacing": 60, "label": "0.30%"},
    10000: {"tick_spacing": 200, "label": "1.00%"},
}

MAX_U128 = (1 << 128) - 1
MAX_U64 = (1 << 64) - 1


# === Helpers ===

def ceil_div(a: int, b: int) -> int:
    assert b > 0 and a >= 0
    return (a + b - 1) // b

def mul_div(a: int, b: int, c: int) -> int:
    assert c > 0
    return (a * b) // c

def mul_div_up(a: int, b: int, c: int) -> int:
    assert c > 0
    return (a * b + c - 1) // c


# === Tick ↔ Price (Q32.64) ===

def tick_to_sqrt_price_x64(tick: int) -> int:
    """Convert tick to sqrt-price in Q32.64 format (u128)."""
    assert MIN_TICK <= tick <= MAX_TICK
    base = Decimal("1.0001")
    sqrt_price = base ** (Decimal(tick) / 2)
    result = int(sqrt_price * Q32_64)
    return max(1, min(result, MAX_U128))

def sqrt_price_x64_to_tick(sqrt_price_x64: int) -> int:
    """Convert sqrt-price (Q32.64) to tick. Rounds DOWN."""
    sqrt_price = Decimal(sqrt_price_x64) / Q32_64
    price = sqrt_price ** 2
    tick = int(Decimal(str(price)).ln() / Decimal("1.0001").ln())
    # Validate rounding
    while tick < MAX_TICK and tick_to_sqrt_price_x64(tick + 1) <= sqrt_price_x64:
        tick += 1
    while tick_to_sqrt_price_x64(tick) > sqrt_price_x64:
        tick -= 1
    return tick


# === Tick Array Mapping ===

def get_tick_array_start_index(tick: int, tick_spacing: int) -> int:
    """Compute the start tick index of the tick array containing `tick`."""
    array_range = TICK_ARRAY_SIZE * tick_spacing
    if tick >= 0:
        return (tick // array_range) * array_range
    else:
        return ((tick - array_range + 1) // array_range) * array_range

def get_tick_offset_in_array(tick: int, tick_spacing: int) -> int:
    """Compute the offset of `tick` within its tick array."""
    start = get_tick_array_start_index(tick, tick_spacing)
    return (tick - start) // tick_spacing


# === Amount Calculations (Q32.64 variant) ===

def get_amount0_delta(sp_lower: int, sp_upper: int, liquidity: int, round_up: bool = False) -> int:
    """Token0 amount for a liquidity range (Q32.64 sqrt-prices)."""
    assert sp_lower <= sp_upper
    if liquidity == 0 or sp_lower == sp_upper:
        return 0
    diff = sp_upper - sp_lower
    numerator = liquidity * diff * Q64
    if round_up:
        return ceil_div(ceil_div(numerator, sp_upper), sp_lower)
    else:
        return numerator // sp_upper // sp_lower

def get_amount1_delta(sp_lower: int, sp_upper: int, liquidity: int, round_up: bool = False) -> int:
    """Token1 amount for a liquidity range (Q32.64 sqrt-prices)."""
    assert sp_lower <= sp_upper
    if liquidity == 0 or sp_lower == sp_upper:
        return 0
    diff = sp_upper - sp_lower
    if round_up:
        return mul_div_up(liquidity, diff, Q64)
    else:
        return mul_div(liquidity, diff, Q64)


# === Swap Step (Solana) ===

def get_next_sqrt_price_from_input(sp: int, liquidity: int, amount_in: int, zero_for_one: bool) -> int:
    assert sp > 0 and liquidity > 0
    if zero_for_one:
        product = amount_in * sp
        denom = (liquidity << 64) + product
        return ceil_div(liquidity * sp * Q64, denom)
    else:
        quotient = mul_div(amount_in, Q64, liquidity)
        return sp + quotient

def compute_swap_step_solana(sp_current: int, sp_target: int, liquidity: int, amount_remaining: int, fee: int) -> dict:
    zero_for_one = sp_current >= sp_target
    amount_remaining_after_fee = amount_remaining * (FEE_DENOMINATOR - fee) // FEE_DENOMINATOR

    if zero_for_one:
        sp_lo, sp_hi = min(sp_target, sp_current), max(sp_target, sp_current)
        amount_in_to_target = get_amount0_delta(sp_lo, sp_hi, liquidity, round_up=True)
    else:
        sp_lo, sp_hi = min(sp_current, sp_target), max(sp_current, sp_target)
        amount_in_to_target = get_amount1_delta(sp_lo, sp_hi, liquidity, round_up=True)

    if amount_remaining_after_fee >= amount_in_to_target:
        sp_next = sp_target
        amount_in = amount_in_to_target
    else:
        sp_next = get_next_sqrt_price_from_input(sp_current, liquidity, amount_remaining_after_fee, zero_for_one)
        sp_lo2, sp_hi2 = min(sp_next, sp_current), max(sp_next, sp_current)
        if zero_for_one:
            amount_in = get_amount0_delta(sp_lo2, sp_hi2, liquidity, round_up=True)
        else:
            amount_in = get_amount1_delta(sp_lo2, sp_hi2, liquidity, round_up=True)

    sp_lo3, sp_hi3 = min(sp_next, sp_current), max(sp_next, sp_current)
    if zero_for_one:
        amount_out = get_amount1_delta(sp_lo3, sp_hi3, liquidity, round_up=False)
    else:
        amount_out = get_amount0_delta(sp_lo3, sp_hi3, liquidity, round_up=False)

    if sp_next != sp_target:
        fee_amount = amount_remaining - amount_in
    else:
        fee_amount = mul_div_up(amount_in, fee, FEE_DENOMINATOR - fee)

    return {
        "sqrt_price_next_x64": str(sp_next),
        "amount_in": amount_in,
        "amount_out": amount_out,
        "fee_amount": fee_amount,
    }


# === Fee Growth (Q64.64) ===

def compute_fee_growth_x64(fee_amount: int, liquidity: int) -> int:
    if liquidity == 0:
        return 0
    return mul_div(fee_amount, Q64, liquidity)


# === Position (PDA-backed) ===

def derive_position_pda_seeds(pool_key: str, owner_key: str, tick_lower: int, tick_upper: int) -> list:
    """Return the seed components for position PDA derivation."""
    return [
        b"omnifi-position",
        bytes.fromhex(pool_key),
        bytes.fromhex(owner_key),
        tick_lower.to_bytes(4, 'little', signed=True),
        tick_upper.to_bytes(4, 'little', signed=True),
    ]


# === Test Vector Generation ===

def generate_vectors() -> dict:
    vectors = {
        "metadata": {
            "generator": "omnifi-solana-clmm-reference-model",
            "version": "1.0",
            "spec": "solana-clmm-spec.md",
            "q64": str(Q64),
            "fee_denominator": FEE_DENOMINATOR,
            "min_tick": MIN_TICK,
            "max_tick": MAX_TICK,
            "tick_array_size": TICK_ARRAY_SIZE,
            "note": "Sqrt-prices use Q32.64 (u128). Fee growth uses Q64.64 (u128).",
        },
        "tick_to_sqrt_price": [],
        "tick_array_mapping": [],
        "swap_step": [],
        "amount_calculations": [],
        "fee_growth": [],
    }

    # --- Tick → SqrtPrice (Q32.64) ---
    for tick in [0, 1, -1, 100, -100, 60, -60, 887272, -887272, 23028, -23028]:
        sp = tick_to_sqrt_price_x64(tick)
        vectors["tick_to_sqrt_price"].append({
            "tick": tick,
            "sqrt_price_x64": str(sp),
            "roundtrip_tick": sqrt_price_x64_to_tick(sp),
        })

    # --- Tick Array Mapping ---
    for tick, ts in [(0, 60), (59, 60), (60, 60), (-1, 60), (-60, 60),
                     (5280, 60), (-5280, 60), (0, 1), (87, 1), (88, 1),
                     (0, 10), (879, 10), (880, 10), (199, 200), (200, 200)]:
        start = get_tick_array_start_index(tick, ts)
        offset = get_tick_offset_in_array(tick, ts)
        vectors["tick_array_mapping"].append({
            "tick": tick,
            "tick_spacing": ts,
            "array_start_index": start,
            "offset_in_array": offset,
            "array_pda_seed_tick": start,
        })

    # --- Swap Steps (Q32.64) ---
    sp_1_1 = tick_to_sqrt_price_x64(0)
    sp_target_down = tick_to_sqrt_price_x64(-60)
    sp_target_up = tick_to_sqrt_price_x64(60)

    vectors["swap_step"].append({
        "name": "typical_step_zeroForOne_solana",
        "inputs": {
            "sqrt_price_current_x64": str(sp_1_1),
            "sqrt_price_target_x64": str(sp_target_down),
            "liquidity": 10**18,
            "amount_remaining": 10**15,
            "fee": 3000,
        },
        "expected": compute_swap_step_solana(sp_1_1, sp_target_down, 10**18, 10**15, 3000),
    })

    vectors["swap_step"].append({
        "name": "typical_step_oneForZero_solana",
        "inputs": {
            "sqrt_price_current_x64": str(sp_1_1),
            "sqrt_price_target_x64": str(sp_target_up),
            "liquidity": 10**18,
            "amount_remaining": 10**15,
            "fee": 3000,
        },
        "expected": compute_swap_step_solana(sp_1_1, sp_target_up, 10**18, 10**15, 3000),
    })

    vectors["swap_step"].append({
        "name": "small_amount_no_cross_solana",
        "inputs": {
            "sqrt_price_current_x64": str(sp_1_1),
            "sqrt_price_target_x64": str(sp_target_down),
            "liquidity": 10**18,
            "amount_remaining": 1000,
            "fee": 3000,
        },
        "expected": compute_swap_step_solana(sp_1_1, sp_target_down, 10**18, 1000, 3000),
    })

    vectors["swap_step"].append({
        "name": "stablecoin_step_0.01pct_solana",
        "inputs": {
            "sqrt_price_current_x64": str(sp_1_1),
            "sqrt_price_target_x64": str(tick_to_sqrt_price_x64(-1)),
            "liquidity": 10**18,
            "amount_remaining": 10**12,
            "fee": 100,
        },
        "expected": compute_swap_step_solana(sp_1_1, tick_to_sqrt_price_x64(-1), 10**18, 10**12, 100),
    })

    # --- Amount Calculations (Q32.64) ---
    for tick_l, tick_u, liq, label in [
        (-60, 60, 10**18, "narrow_range_parity"),
        (-600, 600, 10**18, "wide_range"),
        (-887220, 887220, 10**15, "near_full_range"),
    ]:
        sp_l = tick_to_sqrt_price_x64(tick_l)
        sp_u = tick_to_sqrt_price_x64(tick_u)
        vectors["amount_calculations"].append({
            "name": label,
            "inputs": {
                "tick_lower": tick_l,
                "tick_upper": tick_u,
                "liquidity": liq,
                "sqrt_price_lower_x64": str(sp_l),
                "sqrt_price_upper_x64": str(sp_u),
            },
            "expected": {
                "amount0_round_down": get_amount0_delta(sp_l, sp_u, liq, False),
                "amount0_round_up": get_amount0_delta(sp_l, sp_u, liq, True),
                "amount1_round_down": get_amount1_delta(sp_l, sp_u, liq, False),
                "amount1_round_up": get_amount1_delta(sp_l, sp_u, liq, True),
            },
        })

    # --- Fee Growth (Q64.64) ---
    vectors["fee_growth"].append({
        "name": "basic_fee_growth_solana",
        "inputs": {"fee_amount": 10**15, "liquidity": 10**18},
        "expected": {"fee_growth_x64": str(compute_fee_growth_x64(10**15, 10**18))},
    })
    vectors["fee_growth"].append({
        "name": "small_fee_high_liquidity_solana",
        "inputs": {"fee_amount": 100, "liquidity": 10**24},
        "expected": {"fee_growth_x64": str(compute_fee_growth_x64(100, 10**24))},
    })

    return vectors


def main():
    vectors = generate_vectors()
    print(json.dumps(vectors, indent=2, default=str))


if __name__ == "__main__":
    main()

