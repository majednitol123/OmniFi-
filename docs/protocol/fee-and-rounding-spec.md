# OmniFi — Fee and Rounding Specification

**Version:** 1.0  
**Status:** Phase 1 deliverable  
**Date:** 2026-11-01  
**Related ADRs:** ADR-007 (Accepted), ADR-011  
**Prerequisite for:** All pool math specs, router, SDK, frontend

---

## 1. Fee Tier Configuration

### 1.1 Accepted Fee Tiers (ADR-007)

| Tier ID | LP Fee Rate | Basis Points | Tick Spacing | Typical Use |
|---------|-----------|-------------|--------------|-------------|
| `TIER_001` | 0.01% | 1 bps | 1 | Stablecoin pairs (USDC/USDT) |
| `TIER_005` | 0.05% | 5 bps | 10 | Correlated pairs (ETH/stETH) |
| `TIER_030` | 0.30% | 30 bps | 60 | Standard volatile pairs |
| `TIER_100` | 1.00% | 100 bps | 200 | Exotic/high-volatility pairs |

### 1.2 Fee Representation

Fees are represented as integers in units of **1/1,000,000** (hundredths of a basis point):

| Fee Rate | Integer Representation | Constant |
|----------|----------------------|----------|
| 0.01% | 100 | `FEE_TIER_100` |
| 0.05% | 500 | `FEE_TIER_500` |
| 0.30% | 3000 | `FEE_TIER_3000` |
| 1.00% | 10000 | `FEE_TIER_10000` |

Fee denominator: `FEE_DENOMINATOR = 1_000_000`

### 1.3 Tick Spacing Rationale

Tick spacing constrains which ticks can be initialized as position boundaries:
- Lower tick spacing → finer price granularity → more gas per swap (more ticks crossed)
- Higher tick spacing → coarser granularity → less gas per swap
- Spacing must divide evenly into the tick range

Relationship: `tickSpacing` is chosen such that the price difference between adjacent initializable ticks is approximately proportional to the fee tier.

---

## 2. Fee Application in Swaps

### 2.1 V2 Constant-Product (Reference)

For a swap with input amount `amountIn`:

```
feeAmount = amountIn * fee / FEE_DENOMINATOR          // round UP
amountInAfterFee = amountIn - feeAmount
amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)  // round DOWN
```

Fee is deducted from the input BEFORE computing the output. This is "fee-on-input."

### 2.2 CLMM Concentrated Liquidity

For a swap step within a single tick range:

```
// Given: sqrtPriceCurrent, sqrtPriceTarget, liquidity, amountRemaining, fee

feeAmount = amountIn * fee / (FEE_DENOMINATOR - fee)   // round UP
// This formula computes fee on the NET input (fee is added on top)

amountIn = computeAmountIn(sqrtPriceCurrent, sqrtPriceTarget, liquidity)
amountOut = computeAmountOut(sqrtPriceCurrent, sqrtPriceTarget, liquidity)
```

The exact swap-step formula is specified in `evm-clmm-spec.md` §5.

### 2.3 Fee Growth Accounting (CLMM)

Fees accumulate in two global counters per pool:
- `feeGrowthGlobal0X128` — fee growth for token0, scaled by 2^128
- `feeGrowthGlobal1X128` — fee growth for token1, scaled by 2^128

Per-tick fee growth is tracked to compute fees inside a position range. See `evm-clmm-spec.md` §7.

---

## 3. Protocol Fee

### 3.1 Configuration

- Protocol fee is a fraction of the LP fee (not additive to user cost)
- Range: 0 to `MAX_PROTOCOL_FEE_FRACTION` (accepted: 1/4 = 25% of LP fee)
- Representation: integer numerator with denominator of `PROTOCOL_FEE_DENOMINATOR = 4`
  - 0 = protocol fee off
  - 1 = 25% of LP fee goes to protocol
- Initial setting: **0** (protocol fee off at launch)
- Changes require multisig + 48h timelock (ADR-011)

### 3.2 Calculation

```
protocolFeeAmount = feeAmount * protocolFeeFraction / PROTOCOL_FEE_DENOMINATOR  // round DOWN
lpFeeAmount = feeAmount - protocolFeeAmount
```

Protocol fee rounds DOWN (favors LPs over protocol).

### 3.3 Collection

Protocol fees are accumulated per pool and collected by the protocol fee recipient (multisig). Collection is a separate admin operation, not part of swap execution.

---

## 4. Rounding Policy

### 4.1 Master Rounding Table

| Operation | Direction | Rationale | Implementation |
|-----------|-----------|-----------|----------------|
| **Swap: output amount** | Round DOWN | User receives less → protects pool | Truncating division |
| **Swap: fee from input** | Round UP | Pool collects more → prevents fee leakage | `(a * b + c - 1) / c` |
| **Swap: input required (exact output)** | Round UP | User pays more → protects pool | Ceiling division |
| **Add liquidity: token0 required** | Round UP | Depositor provides more → protects existing LPs | Ceiling division |
| **Add liquidity: token1 required** | Round UP | Depositor provides more → protects existing LPs | Ceiling division |
| **Add liquidity: liquidity minted** | Round DOWN | Depositor gets less liquidity → protects pool | Truncating division |
| **Remove liquidity: token0 returned** | Round DOWN | Withdrawer receives less → protects remaining LPs | Truncating division |
| **Remove liquidity: token1 returned** | Round DOWN | Withdrawer receives less → protects remaining LPs | Truncating division |
| **Fee growth accumulation** | Round DOWN | Prevents fee over-counting | Truncating division |
| **Fee growth inside position** | Round DOWN | Position receives less → prevents over-claim | Truncating division |
| **Protocol fee split** | Round DOWN | Protocol receives less → favors LPs | Truncating division |
| **Tick → price conversion** | Exact (precomputed) | No rounding — lookup or precise formula | — |
| **Price → tick conversion** | Round DOWN (toward zero) | Conservative tick assignment | Truncating |
| **Sqrt price computation** | Round DOWN | Conservative price estimate | — |

### 4.2 Rounding Implementation

**Ceiling division (round up):**
```
function ceilDiv(a, b):
    return (a + b - 1) / b      // integer division
```

**Truncating division (round down):**
```
function floorDiv(a, b):
    return a / b                 // integer division (default in Solidity/Rust)
```

### 4.3 Overflow Protection

- All arithmetic uses checked operations (Solidity 0.8+ default, Rust `checked_*`)
- Explicit `unchecked` blocks only where overflow is mathematically proven impossible
- Maximum values: `uint256` max for EVM, `u128` for most Solana amounts
- Intermediate products may require `uint512` or `U256` in Rust — use `mulDiv` helpers

---

## 5. Dust and Minimum Amounts

### 5.1 Minimum Swap Input

- Must be > 0
- Must produce a non-zero output after fees
- If output would round to 0, reject the swap

### 5.2 Minimum Liquidity (V2)

For V2 constant-product pools, the first depositor must provide minimum liquidity to prevent manipulation:

```
MINIMUM_LIQUIDITY = 1000    // permanently locked (sent to zero address)
```

This prevents the first LP from manipulating the pool with tiny liquidity.

### 5.3 Minimum Position Size (CLMM)

- Position liquidity must be > 0
- Token amounts computed from liquidity must each be > 0 for the position to be meaningful
- Extremely narrow ranges with near-zero liquidity should be rejected

### 5.4 Dust Threshold for Fee Collection

- Fees below 1 unit of the smallest token denomination are not collectible
- Accumulated fees are always available but collection transaction cost may exceed fee value for very small amounts — this is expected behavior, not a bug

---

## 6. Fee Disclosure Requirements

Every quote and transaction confirmation must show:

| Field | Description |
|-------|-------------|
| `lpFeeRate` | LP fee tier as a percentage |
| `lpFeeAmount` | Estimated LP fee in input token units |
| `protocolFeeAmount` | Estimated protocol fee (if enabled) |
| `networkFeeEstimate` | Estimated gas (EVM) or compute+priority fee (Solana) |
| `priceImpact` | Percentage price change caused by the swap |
| `minimumReceived` | Minimum output enforced by slippage setting |
| `routeHops` | Each hop with its pool, fee tier, and amounts |

No fee may be hidden or bundled into an opaque "total."

