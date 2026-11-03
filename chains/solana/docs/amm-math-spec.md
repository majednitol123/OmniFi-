# OmniFi — Solana Native AMM Mathematical Specification

## 1. Executive Summary

This document specifies the exact mathematical formulas, precision guarantees, invariant invariants, and rounding conventions for the **OmniFi Native Constant-Product AMM** implemented in Anchor/Rust (`chains/solana/programs/omnifi_amm`).

All calculations execute using pure integer arithmetic with `u64` storage types and intermediate `u128` precision to eliminate numerical overflow and truncation vulnerability, conforming strictly to **ADR-005** and **ADR-008**.

---

## 2. Global Constants & Fee Scales

| Parameter | Type | Value | Interpretation |
|---|---|---|---|
| `FEE_DENOMINATOR` | `u64` | `1,000,000` | 100% fee representation (1 ppm = 0.0001%) |
| `MAX_TOTAL_FEE_BPS` | `u64` | `100,000` | 10% maximum pool swap fee |
| `MAX_PROTOCOL_FEE_FRACTION` | `u64` | `250,000` | 25% maximum fraction of pool fee routed to protocol |
| `MINIMUM_LIQUIDITY` | `u64` | `1,000` | Permanently burned LP tokens on pool initialization |

---

## 3. Mathematical Foundations

The AMM operates on the constant-product curve:

$$k = x \cdot y$$

Where:
- $x$: Current pool reserve for Token 0 (`reserve_0`)
- $y$: Current pool reserve for Token 1 (`reserve_1`)
- $k$: Invariant of the pool, non-decreasing across all non-liquidity operations.

---

## 4. Swap Execution & Fee Isolation (F-05 Resolution)

### 4.1 Fee Computation

Given an exact input token amount $\Delta x$:

1. **Total Fee:**
   $$\Delta x_{\text{fee}} = \left\lfloor \frac{\Delta x \cdot f_{\text{pool}}}{\text{FEE\_DENOMINATOR}} \right\rfloor$$

2. **Protocol Cut:**
   $$\text{fee}_{\text{protocol}} = \left\lfloor \frac{\Delta x_{\text{fee}} \cdot f_{\text{proto\_fraction}}}{\text{FEE\_DENOMINATOR}} \right\rfloor$$

3. **LP Fee Retention:**
   $$\text{fee}_{\text{lp}} = \Delta x_{\text{fee}} - \text{fee}_{\text{protocol}}$$

4. **Effective Input for Curve Output:**
   $$\Delta x_{\text{curve}} = \Delta x - \Delta x_{\text{fee}}$$

5. **Net Reserve Inflow:**
   $$\Delta x_{\text{reserve}} = \Delta x - \text{fee}_{\text{protocol}} = \Delta x_{\text{curve}} + \text{fee}_{\text{lp}}$$

### 4.2 Output Amount ($\Delta y$)

The output token amount credited to the user is derived from the constant-product curve:

$$\Delta y = \left\lfloor \frac{y \cdot \Delta x_{\text{curve}}}{x + \Delta x_{\text{curve}}} \right\rfloor$$

### 4.3 State Updates & Accounting Isolation

To prevent LP withdrawal underflows, protocol fees are strictly sequestered from the pool reserve:

$$\text{reserve}_{\text{in, new}} = x + \Delta x_{\text{reserve}}$$

$$\text{reserve}_{\text{out, new}} = y - \Delta y$$

$$\text{protocol\_fees}_{\text{accumulated, new}} = \text{protocol\_fees} + \text{fee}_{\text{protocol}}$$

#### Physical SPL Token Vault Balance Invariant:
$$\text{VaultBalance}_{\text{token}} \ge \text{Reserve}_{\text{token}} + \text{ProtocolFees}_{\text{token}}$$

When protocol fees are withdrawn via `collect_fees`, only `protocol_fees` decrease; pool reserves $x$ and $y$ remain unaltered, preventing any impact on LP redemption value.

---

## 5. Liquidity Provisioning

### 5.1 Initial Deposit ($L_0$)

When initializing a new pool with initial deposits $\Delta x_0$ and $\Delta y_0$:

$$L_{\text{total}} = \lfloor \sqrt{\Delta x_0 \cdot \Delta y_0} \rfloor$$

$$L_{\text{minted}} = L_{\text{total}} - \text{MINIMUM\_LIQUIDITY}$$

$\text{MINIMUM\_LIQUIDITY} = 1,000$ tokens are locked in the pool authority PDA to permanently prevent empty-pool price manipulation attacks.

### 5.2 Subsequent Add Liquidity

For subsequent deposits of $\Delta x$ and $\Delta y$ with existing total LP supply $S$:

$$L_{\text{minted}} = \min \left( \left\lfloor \frac{\Delta x \cdot S}{x} \right\rfloor, \left\lfloor \frac{\Delta y \cdot S}{y} \right\rfloor \right)$$

If $\frac{\Delta x}{x} \ne \frac{\Delta y}{y}$, the excess token remains in the user's account or is refunded to avoid uncompensated pool donations.

---

## 6. Liquidity Removal (Burn)

When burning $\Delta L$ LP tokens from a total supply $S$:

$$\Delta x = \left\lfloor \frac{x \cdot \Delta L}{S} \right\rfloor$$

$$\Delta y = \left\lfloor \frac{y \cdot \Delta L}{S} \right\rfloor$$

Reserves update as:
$$x_{\text{new}} = x - \Delta x$$
$$y_{\text{new}} = y - \Delta y$$
$$S_{\text{new}} = S - \Delta L$$

---

## 7. Precision & Rounding Rules

1. **Down-rounding on Outputs:** All token outputs to users ($\Delta y$, $\Delta x_{\text{redeemed}}$, $\Delta y_{\text{redeemed}}$) truncate towards zero (`floor`), ensuring the AMM retains fractional rounding residues in favor of remaining LPs.
2. **Intermediate Promotion:** All multiplications of `u64` values are promoted to `u128` prior to division:
   ```rust
   let amount_out = (reserve_out as u128)
       .checked_mul(amount_in_curve as u128)
       .ok_or(AmmError::MathOverflow)?
       .checked_div((reserve_in as u128).checked_add(amount_in_curve as u128).ok_or(AmmError::MathOverflow)?)
       .ok_or(AmmError::ZeroDivision)? as u64;
   ```
3. **Slippage Enforcement:** Every user swap specifies `min_amount_out`:
   $$\Delta y \ge \text{min\_amount\_out}$$
   If $\Delta y < \text{min\_amount\_out}$, the instruction aborts immediately with `AmmError::SlippageExceeded`.

