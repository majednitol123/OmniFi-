"""
OmniFi — V2 Constant-Product AMM Reference Model

This is an independent reference implementation of the V2 AMM math
for generating deterministic test vectors. It uses Python's Decimal
type for arbitrary-precision arithmetic, then converts to integer
results matching the on-chain Solidity/Rust behavior.

All formulas correspond to evm-v2-spec.md.
No floating-point is used in any calculation.
"""

from decimal import Decimal, ROUND_DOWN, ROUND_UP, getcontext
import json
import math
import sys

# Set extremely high precision for Decimal operations
getcontext().prec = 100

# === Constants ===

FEE_DENOMINATOR = 1_000_000
MINIMUM_LIQUIDITY = 1000
PROTOCOL_FEE_DENOMINATOR = 4

# Supported fee tiers (integer representation)
FEE_TIERS = [100, 500, 3000, 10000]

# Maximum reserve value (uint112)
MAX_RESERVE = (1 << 112) - 1

# Maximum LP token supply (uint256, but practically limited)
MAX_UINT256 = (1 << 256) - 1


# === Helper Functions ===

def ceil_div(a: int, b: int) -> int:
    """Integer ceiling division: ceil(a / b)"""
    assert b > 0, "Division by zero"
    assert a >= 0, "Negative numerator not supported"
    return (a + b - 1) // b


def isqrt(n: int) -> int:
    """Integer square root (floor). Uses Newton's method."""
    if n < 0:
        raise ValueError("Square root of negative number")
    if n == 0:
        return 0
    x = n
    y = (x + 1) // 2
    while y < x:
        x = y
        y = (x + n // x) // 2
    return x


# === V2 AMM Core Functions ===

def compute_fee(amount_in: int, fee: int) -> int:
    """
    Compute swap fee from input amount.
    Fee is deducted from input BEFORE computing output.
    Rounding: UP (pool collects more).
    """
    return ceil_div(amount_in * fee, FEE_DENOMINATOR)


def compute_protocol_fee(fee_amount: int, protocol_fee_fraction: int) -> int:
    """
    Compute protocol fee as a fraction of the LP fee.
    Rounding: DOWN (protocol receives less, favors LPs).
    """
    return fee_amount * protocol_fee_fraction // PROTOCOL_FEE_DENOMINATOR


def swap_exact_input(
    reserve_in: int,
    reserve_out: int,
    amount_in: int,
    fee: int,
    protocol_fee_fraction: int = 0,
) -> dict:
    """
    Compute swap output for exact input amount.
    
    Returns dict with all computed values.
    """
    assert reserve_in > 0 and reserve_out > 0, "Empty reserves"
    assert amount_in > 0, "Zero input"
    assert fee in FEE_TIERS, f"Unsupported fee tier: {fee}"

    # Step 1: Compute fee (round UP)
    fee_amount = compute_fee(amount_in, fee)
    amount_in_after_fee = amount_in - fee_amount
    assert amount_in_after_fee > 0, "Fee exceeds input"

    # Step 2: Compute output (round DOWN — truncating integer division)
    numerator = reserve_out * amount_in_after_fee
    denominator = reserve_in + amount_in_after_fee
    amount_out = numerator // denominator
    assert amount_out > 0, "Zero output"
    assert amount_out < reserve_out, "Output exceeds reserve"

    # Step 3: Protocol fee (round DOWN)
    protocol_fee = compute_protocol_fee(fee_amount, protocol_fee_fraction)
    lp_fee = fee_amount - protocol_fee

    # Step 4: New reserves
    new_reserve_in = reserve_in + amount_in_after_fee
    new_reserve_out = reserve_out - amount_out

    # Step 5: Invariant check (k must not decrease)
    k_before = reserve_in * reserve_out
    k_after = new_reserve_in * new_reserve_out
    assert k_after >= k_before, f"Invariant violated: {k_after} < {k_before}"

    return {
        "amount_in": amount_in,
        "fee_amount": fee_amount,
        "lp_fee": lp_fee,
        "protocol_fee": protocol_fee,
        "amount_in_after_fee": amount_in_after_fee,
        "amount_out": amount_out,
        "new_reserve_in": new_reserve_in,
        "new_reserve_out": new_reserve_out,
        "k_before": str(k_before),
        "k_after": str(k_after),
    }


def swap_exact_output(
    reserve_in: int,
    reserve_out: int,
    amount_out: int,
    fee: int,
    protocol_fee_fraction: int = 0,
) -> dict:
    """
    Compute required input for exact output amount.
    """
    assert reserve_in > 0 and reserve_out > 0, "Empty reserves"
    assert amount_out > 0, "Zero output"
    assert amount_out < reserve_out, "Output exceeds reserve"
    assert fee in FEE_TIERS, f"Unsupported fee tier: {fee}"

    # Step 1: Compute net input required (round UP)
    numerator = reserve_in * amount_out
    denominator = reserve_out - amount_out
    amount_in_net = ceil_div(numerator, denominator)

    # Step 2: Gross input including fee (round UP)
    amount_in = ceil_div(amount_in_net * FEE_DENOMINATOR, FEE_DENOMINATOR - fee)

    # Step 3: Compute fee
    fee_amount = amount_in - amount_in_net
    protocol_fee = compute_protocol_fee(fee_amount, protocol_fee_fraction)
    lp_fee = fee_amount - protocol_fee

    # Step 4: New reserves
    new_reserve_in = reserve_in + amount_in_net
    new_reserve_out = reserve_out - amount_out

    # Step 5: Invariant check
    k_before = reserve_in * reserve_out
    k_after = new_reserve_in * new_reserve_out
    assert k_after >= k_before, f"Invariant violated: {k_after} < {k_before}"

    return {
        "amount_in": amount_in,
        "fee_amount": fee_amount,
        "lp_fee": lp_fee,
        "protocol_fee": protocol_fee,
        "amount_in_net": amount_in_net,
        "amount_out": amount_out,
        "new_reserve_in": new_reserve_in,
        "new_reserve_out": new_reserve_out,
        "k_before": str(k_before),
        "k_after": str(k_after),
    }


def add_liquidity_initial(amount0: int, amount1: int) -> dict:
    """
    First liquidity deposit into an empty pool.
    """
    assert amount0 > 0 and amount1 > 0, "Zero amounts"

    lp_minted_total = isqrt(amount0 * amount1)
    assert lp_minted_total > MINIMUM_LIQUIDITY, "Insufficient initial liquidity"

    lp_minted_user = lp_minted_total - MINIMUM_LIQUIDITY
    lp_burned = MINIMUM_LIQUIDITY  # sent to dead address

    return {
        "amount0": amount0,
        "amount1": amount1,
        "lp_minted_total": lp_minted_total,
        "lp_minted_user": lp_minted_user,
        "lp_burned": lp_burned,
        "reserve0": amount0,
        "reserve1": amount1,
        "total_supply": lp_minted_total,
    }


def add_liquidity_subsequent(
    reserve0: int, reserve1: int, total_supply: int, amount0: int, amount1: int
) -> dict:
    """
    Subsequent liquidity deposit into an existing pool.
    LP tokens minted = min of proportional amounts (round DOWN).
    """
    assert reserve0 > 0 and reserve1 > 0, "Empty reserves"
    assert total_supply > 0, "Zero supply"
    assert amount0 > 0 and amount1 > 0, "Zero amounts"

    # Compute LP tokens from each amount (round DOWN)
    lp_from_0 = amount0 * total_supply // reserve0
    lp_from_1 = amount1 * total_supply // reserve1

    # Use minimum (round DOWN — protects existing LPs)
    lp_minted = min(lp_from_0, lp_from_1)
    assert lp_minted > 0, "Would mint zero LP tokens"

    # Compute actual amounts used (proportional to lp_minted)
    # The user may need to adjust their amounts to match the ratio
    actual_amount0 = ceil_div(lp_minted * reserve0, total_supply)
    actual_amount1 = ceil_div(lp_minted * reserve1, total_supply)

    return {
        "amount0_desired": amount0,
        "amount1_desired": amount1,
        "lp_minted": lp_minted,
        "actual_amount0": actual_amount0,
        "actual_amount1": actual_amount1,
        "new_reserve0": reserve0 + actual_amount0,
        "new_reserve1": reserve1 + actual_amount1,
        "new_total_supply": total_supply + lp_minted,
    }


def remove_liquidity(
    reserve0: int, reserve1: int, total_supply: int, lp_burned: int
) -> dict:
    """
    Remove liquidity by burning LP tokens.
    Token amounts returned: round DOWN.
    """
    assert reserve0 > 0 and reserve1 > 0, "Empty reserves"
    assert total_supply > 0, "Zero supply"
    assert lp_burned > 0, "Zero burn"
    assert lp_burned <= total_supply - MINIMUM_LIQUIDITY, "Cannot burn minimum liquidity"

    # Round DOWN — withdrawer receives less
    amount0 = lp_burned * reserve0 // total_supply
    amount1 = lp_burned * reserve1 // total_supply
    assert amount0 > 0 or amount1 > 0, "Would return zero tokens"

    return {
        "lp_burned": lp_burned,
        "amount0": amount0,
        "amount1": amount1,
        "new_reserve0": reserve0 - amount0,
        "new_reserve1": reserve1 - amount1,
        "new_total_supply": total_supply - lp_burned,
    }


# === Test Vector Generation ===

def generate_vectors() -> dict:
    """Generate deterministic test vectors covering all cases."""

    vectors = {
        "metadata": {
            "generator": "omnifi-v2-reference-model",
            "version": "1.0",
            "spec": "evm-v2-spec.md",
            "fee_denominator": FEE_DENOMINATOR,
            "minimum_liquidity": MINIMUM_LIQUIDITY,
            "description": "Deterministic test vectors for V2 constant-product AMM",
        },
        "swap_exact_input": [],
        "swap_exact_output": [],
        "add_liquidity_initial": [],
        "add_liquidity_subsequent": [],
        "remove_liquidity": [],
    }

    # --- Swap Exact Input vectors ---

    # Typical: moderate amounts, 0.30% fee
    vectors["swap_exact_input"].append({
        "name": "typical_swap_0.30pct",
        "inputs": {"reserve_in": 1_000_000_000_000, "reserve_out": 1_000_000_000_000,
                    "amount_in": 1_000_000_000, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(1_000_000_000_000, 1_000_000_000_000,
                                      1_000_000_000, 3000, 0),
    })

    # Small swap in large pool
    vectors["swap_exact_input"].append({
        "name": "small_swap_large_pool",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_in": 1000, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**18, 10**18, 1000, 3000, 0),
    })

    # Large swap (high price impact)
    vectors["swap_exact_input"].append({
        "name": "large_swap_high_impact",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_in": 5 * 10**17, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**18, 10**18, 5 * 10**17, 3000, 0),
    })

    # With protocol fee
    vectors["swap_exact_input"].append({
        "name": "swap_with_protocol_fee",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_in": 10**15, "fee": 3000, "protocol_fee_fraction": 1},
        "expected": swap_exact_input(10**18, 10**18, 10**15, 3000, 1),
    })

    # 0.01% fee tier (stablecoins)
    vectors["swap_exact_input"].append({
        "name": "stablecoin_swap_0.01pct",
        "inputs": {"reserve_in": 10**12, "reserve_out": 10**12,
                    "amount_in": 10**9, "fee": 100, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**12, 10**12, 10**9, 100, 0),
    })

    # 1.00% fee tier (exotic)
    vectors["swap_exact_input"].append({
        "name": "exotic_swap_1.00pct",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**12,
                    "amount_in": 10**15, "fee": 10000, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**18, 10**12, 10**15, 10000, 0),
    })

    # Asymmetric reserves (very different token decimals/values)
    vectors["swap_exact_input"].append({
        "name": "asymmetric_reserves",
        "inputs": {"reserve_in": 10**6, "reserve_out": 10**18,
                    "amount_in": 10**4, "fee": 500, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**6, 10**18, 10**4, 500, 0),
    })

    # Minimum meaningful swap
    vectors["swap_exact_input"].append({
        "name": "minimum_swap",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_in": 100, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_input(10**18, 10**18, 100, 3000, 0),
    })

    # --- Swap Exact Output vectors ---

    vectors["swap_exact_output"].append({
        "name": "typical_exact_output",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_out": 10**15, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_output(10**18, 10**18, 10**15, 3000, 0),
    })

    vectors["swap_exact_output"].append({
        "name": "exact_output_with_protocol_fee",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_out": 10**15, "fee": 3000, "protocol_fee_fraction": 1},
        "expected": swap_exact_output(10**18, 10**18, 10**15, 3000, 1),
    })

    vectors["swap_exact_output"].append({
        "name": "small_exact_output",
        "inputs": {"reserve_in": 10**18, "reserve_out": 10**18,
                    "amount_out": 1000, "fee": 3000, "protocol_fee_fraction": 0},
        "expected": swap_exact_output(10**18, 10**18, 1000, 3000, 0),
    })

    # --- Add Liquidity Initial vectors ---

    vectors["add_liquidity_initial"].append({
        "name": "balanced_initial",
        "inputs": {"amount0": 10**18, "amount1": 10**18},
        "expected": add_liquidity_initial(10**18, 10**18),
    })

    vectors["add_liquidity_initial"].append({
        "name": "asymmetric_initial",
        "inputs": {"amount0": 10**6, "amount1": 10**18},
        "expected": add_liquidity_initial(10**6, 10**18),
    })

    vectors["add_liquidity_initial"].append({
        "name": "small_initial",
        "inputs": {"amount0": 100_000, "amount1": 100_000},
        "expected": add_liquidity_initial(100_000, 100_000),
    })

    # --- Add Liquidity Subsequent vectors ---

    vectors["add_liquidity_subsequent"].append({
        "name": "proportional_add",
        "inputs": {"reserve0": 10**18, "reserve1": 10**18,
                    "total_supply": 10**18, "amount0": 10**15, "amount1": 10**15},
        "expected": add_liquidity_subsequent(10**18, 10**18, 10**18, 10**15, 10**15),
    })

    vectors["add_liquidity_subsequent"].append({
        "name": "imbalanced_add",
        "inputs": {"reserve0": 10**18, "reserve1": 2 * 10**18,
                    "total_supply": 10**18, "amount0": 10**15, "amount1": 10**15},
        "expected": add_liquidity_subsequent(10**18, 2 * 10**18, 10**18,
                                              10**15, 10**15),
    })

    # --- Remove Liquidity vectors ---

    vectors["remove_liquidity"].append({
        "name": "partial_remove",
        "inputs": {"reserve0": 10**18, "reserve1": 10**18,
                    "total_supply": 10**18, "lp_burned": 10**15},
        "expected": remove_liquidity(10**18, 10**18, 10**18, 10**15),
    })

    vectors["remove_liquidity"].append({
        "name": "large_remove",
        "inputs": {"reserve0": 10**18, "reserve1": 10**18,
                    "total_supply": 10**18, "lp_burned": 10**18 - MINIMUM_LIQUIDITY},
        "expected": remove_liquidity(10**18, 10**18, 10**18, 10**18 - MINIMUM_LIQUIDITY),
    })

    vectors["remove_liquidity"].append({
        "name": "asymmetric_remove",
        "inputs": {"reserve0": 10**6, "reserve1": 10**18,
                    "total_supply": 10**12, "lp_burned": 10**9},
        "expected": remove_liquidity(10**6, 10**18, 10**12, 10**9),
    })

    return vectors


def main():
    vectors = generate_vectors()
    output = json.dumps(vectors, indent=2, default=str)
    print(output)
    return vectors


if __name__ == "__main__":
    main()

