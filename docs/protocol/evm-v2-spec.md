# OmniFi — EVM V2 Constant-Product AMM Math Specification

**Version:** 1.0  
**Status:** Phase 1 deliverable  
**Date:** 2026-11-01  
**Author:** OmniFi Core Protocol Team  
**Scope:** Reference AMM Implementation  
**Related ADRs:** [ADR-002 (V2 Inclusion)](../adr/ADR-002-v2-inclusion.md), [ADR-006 (Token Policy)](../adr/ADR-006-token-policy.md), [ADR-007 (Fee & Economic Parameters)](../adr/ADR-007-economic-parameters.md), [ADR-011 (Admin & Custody)](../adr/ADR-011-admin-custody.md)  
**Normative Reference:** [Fee and Rounding Specification](fee-and-rounding-spec.md)

---

## Scope and Intent

This document specifies the mathematics, arithmetic bounds, state transition rules, and safety invariants for OmniFi's EVM V2 constant-product automated market maker (AMM).

> [!IMPORTANT]
> **Reference AMM Status (ADR-002)**  
> OmniFi V2 is an internal reference and testing AMM. It is designed to validate end-to-end DEX infrastructure (factories, pool registries, routers, indexers, SDKs, and user interfaces) against a deterministic, mathematically simple model. Concentrated Liquidity (CLMM) is OmniFi's primary production protocol. **No production deployment or public capital commitment is planned for V2 in Release 1.** All contracts specified herein deploy strictly to local and internal test environments unless explicitly promoted via a subsequent Architecture Decision Record.

---

## Table of Contents

1. [Architectural Overview & Core Components](#1-architectural-overview--core-components)
2. [§1: Pool Model and Invariant](#2-1-pool-model-and-invariant)
3. [§2: Swap Formulas (Integer Arithmetic)](#3-2-swap-formulas-integer-arithmetic)
4. [§3: Reserve Update Order and Safety](#4-3-reserve-update-order-and-safety)
5. [§4: Add/Remove Liquidity and LP Token Math](#5-4-addremove-liquidity-and-lp-token-math)
6. [§5: Protocol Fee Accounting](#6-5-protocol-fee-accounting)
7. [§6: Donation and Sync Behavior](#7-6-donation-and-sync-behavior)
8. [§7: Events and Custom Errors](#8-7-events-and-custom-errors)
9. [§8: Router and Multi-Hop Execution](#9-8-router-and-multi-hop-execution)
10. [Arithmetic Reference & Overflow Analysis](#10-arithmetic-reference--overflow-analysis)

---

## 1. Architectural Overview & Core Components

The OmniFi V2 reference protocol consists of four modular components:

```
+-------------------------------------------------------------+
|                     OmniFiV2Router                          |
|  - Multi-hop routing (getAmountOut, getAmountIn)            |
|  - Slippage control (amountOutMin, amountInMax, deadline)   |
|  - Safe ERC-20 transfer coordination                        |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                     OmniFiV2Factory                         |
|  - Canonical pool registry: pairFor(tokenA, tokenB)         |
|  - Deterministic CREATE2 pair deployment                    |
|  - Protocol fee configuration & recipient management        |
+-------------------------------------------------------------+
                               | creates
                               v
+-------------------------------------------------------------+
|                      OmniFiV2Pair                           |
|  - Constant-product engine: x * y = k                       |
|  - Reserve storage (packed uint112, uint112, uint32)       |
|  - Cumulative price accumulator (TWAP oracle)               |
|  - Direct protocol fee counter accumulation                 |
+-------------------------------------------------------------+
                               | inherits
                               v
+-------------------------------------------------------------+
|                     OmniFiV2ERC20                           |
|  - Standard ERC-20 liquidity share token                    |
|  - Permanent lock of MINIMUM_LIQUIDITY (1000 units)         |
+-------------------------------------------------------------+
```

1. **`OmniFiV2Factory`**: Deploys unique pair instances deterministically using `CREATE2` and maintains the registry mapping `getPair[tokenA][tokenB]`. Enforces canonical token ordering. Holds governance settings for protocol fee fraction and recipient.
2. **`OmniFiV2Pair`**: The core execution contract containing pool reserves, swap execution, fee calculation, LP mint/burn operations, TWAP accumulation, and reentrancy protection.
3. **`OmniFiV2ERC20`**: Standard fungible ERC-20 token tracking liquidity ownership shares. Burned upon liquidity redemption.
4. **`OmniFiV2Router`**: Stateless peripheral contract that computes exact quotes, executes multi-hop trade paths, enforces user slippage tolerance, and manages ERC-20 allowances safely.

---

## 2. §1: Pool Model and Invariant

### 1.1 Two-Asset Constant-Product Model

An OmniFi V2 pool holds reserves of two distinct ERC-20 tokens, denoted as $token0$ and $token1$, with reserve balances:
$$x = \text{reserve0}, \quad y = \text{reserve1}$$

The pool enforces the constant-product trading invariant:
$$k = x \cdot y$$

- Under zero-fee conditions, every valid swap satisfies:
  $$(x + \Delta x)(y - \Delta y) = k$$
- With fees deducted from the input token, the effective invariant increases monotonically over time:
  $$k_{\text{after}} \ge k_{\text{before}}$$
- Liquidity additions increase $k$ strictly; liquidity removals decrease $k$ strictly.

### 1.2 Canonical Token Ordering

To prevent duplicate pools for the same asset pair, tokens are sorted lexicographically by their 160-bit EVM addresses:

$$\text{token0} < \text{token1} \iff \text{uint160}(\text{token0}) < \text{uint160}(\text{token1})$$

**Rules:**
- A pair between identical tokens ($\text{tokenA} == \text{tokenB}$) is strictly forbidden.
- The zero address ($\text{address}(0)$) is strictly forbidden.
- For any query or deployment with input tokens $(A, B)$:
  $$\text{token0} = A < B \ ? \ A : B, \quad \text{token1} = A < B \ ? \ B : A$$

### 1.3 Reserve Storage and Packing

Reserves are stored in contract storage packed into a single 256-bit EVM storage slot to minimize `SLOAD` and `SSTORE` gas costs:

```
+------------------------------------------------------------------------+
| Bit 0..111 (112 bits) | Bit 112..223 (112 bits) | Bit 224..255 (32 bits) |
| reserve0 (uint112)    | reserve1 (uint112)     | blockTimestampLast     |
+------------------------------------------------------------------------+
```

| Field | Type | Storage Size | Maximum Value | Rationale |
|---|---|---|---|---|
| `reserve0` | `uint112` | 112 bits | $2^{112} - 1 \approx 5.192 \times 10^{33}$ | Supports up to $5.19 \times 10^{15}$ tokens with 18 decimals |
| `reserve1` | `uint112` | 112 bits | $2^{112} - 1 \approx 5.192 \times 10^{33}$ | Supports up to $5.19 \times 10^{15}$ tokens with 18 decimals |
| `blockTimestampLast` | `uint32` | 32 bits | $2^{32} - 1 \approx 4.29 \times 10^9$ | Unix timestamp in seconds (valid past year 2106 via modulo) |

> [!NOTE]
> **Reserve Overflow Bound**  
> If an addition to either reserve causes `reserve > type(uint112).max`, the transaction reverts with `Overflow()`.

### 1.4 Time-Weighted Average Price (TWAP) Oracle

To provide manipulation-resistant pricing for testing off-chain and on-chain systems, each pool maintains cumulative price accumulators updated at the first interaction of each block:

- `price0CumulativeLast` (`uint256`): Accumulator for price of `token0` denominated in `token1`.
- `price1CumulativeLast` (`uint256`): Accumulator for price of `token1` denominated in `token0`.

Prices are encoded in UQ112x112 fixed-point format (fraction scaled by $2^{112}$):

$$\text{spotPrice0} = \frac{\text{reserve1} \cdot 2^{112}}{\text{reserve0}}, \quad \text{spotPrice1} = \frac{\text{reserve0} \cdot 2^{112}}{\text{reserve1}}$$

**Accumulator Update Pseudocode:**

```
function updateOracle(balance0, balance1, reserve0, reserve1):
    currentBlockTimestamp = uint32(block.timestamp % 2^32)
    timeElapsed = currentBlockTimestamp - blockTimestampLast   // uint32 overflow is desired

    if timeElapsed > 0 and reserve0 > 0 and reserve1 > 0:
        // Compute UQ112x112 spot price and accumulate (mod 2^256)
        price0CumulativeLast += uint256(UQ112x112_encode(reserve1) / reserve0) * timeElapsed
        price1CumulativeLast += uint256(UQ112x112_encode(reserve0) / reserve1) * timeElapsed

    reserve0 = uint112(balance0)
    reserve1 = uint112(balance1)
    blockTimestampLast = currentBlockTimestamp
```

---

## 3. §2: Swap Formulas (Integer Arithmetic)

All arithmetic operations use pure integer arithmetic. Floating-point operations are strictly prohibited. Every formula has an explicit, mathematically sound rounding direction.

### 2.1 Fee Representation

Per [Fee and Rounding Specification](fee-and-rounding-spec.md) §1:
- Base Denominator: `FEE_DENOMINATOR = 1_000_000` (100% = $10^6$)
- Standard LP Swap Fee: `fee = 3000` (0.30% = 30 bps = 3,000 / 1,000,000)

### 2.2 Fee-on-Input Calculation

Fee is deducted directly from the gross input amount before executing the constant-product exchange:

$$\text{feeAmount} = \left\lceil \frac{\text{amountIn} \cdot \text{fee}}{\text{FEE\_DENOMINATOR}} \right\rceil$$

**Pseudocode:**
```
function computeFeeAmount(amountIn, fee):
    // Ceiling division: round UP
    return (amountIn * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR
```

**Net Input Amount:**
$$\text{amountInAfterFee} = \text{amountIn} - \text{feeAmount}$$

- **Rounding Direction:** Round **UP** on `feeAmount`.
- **Economic Rationale:** Ceiling division prevents fee leakage on micro-swaps. The pool collects at least the specified fee percentage, protecting existing liquidity providers.
- **Precondition:** `amountIn > 0` and `amountInAfterFee > 0`.

### 2.3 Exact Input Swap (`getAmountOut`)

Given an exact gross input $\text{amountIn}$, compute the net output $\text{amountOut}$ received by the trader.

From the constant-product relationship on net reserves:
$$(\text{reserveIn} + \text{amountInAfterFee})(\text{reserveOut} - \text{amountOut}) \ge \text{reserveIn} \cdot \text{reserveOut}$$

Solving for $\text{amountOut}$:
$$\text{amountOut} = \left\lfloor \frac{\text{reserveOut} \cdot \text{amountInAfterFee}}{\text{reserveIn} + \text{amountInAfterFee}} \right\rfloor$$

**Full Pseudocode:**
```
function getAmountOut(amountIn, reserveIn, reserveOut, fee):
    require(amountIn > 0, "InsufficientInputAmount")
    require(reserveIn > 0 and reserveOut > 0, "InsufficientLiquidity")

    feeAmount = (amountIn * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR    // round UP
    amountInAfterFee = amountIn - feeAmount
    require(amountInAfterFee > 0, "InsufficientInputAmount")

    numerator = reserveOut * amountInAfterFee
    denominator = reserveIn + amountInAfterFee

    amountOut = numerator / denominator                                    // round DOWN (integer division)
    require(amountOut > 0, "InsufficientOutputAmount")
    return amountOut
```

- **Rounding Direction:** Round **DOWN** on `amountOut`.
- **Economic Rationale:** Truncation ensures the trader receives less than or equal to the exact continuous value, leaving the unallocated fractional dust in the pool.
- **Overflow Analysis:**
  - `amountIn * fee`: Max $\approx (2^{112} - 1) \times 10^6 \approx 5.19 \times 10^{39} \ll 2^{256} - 1$.
  - `reserveOut * amountInAfterFee`: Max $\approx (2^{112} - 1) \times (2^{112} - 1) \approx 2^{224} \ll 2^{256} - 1$.
  - `denominator`: Fits comfortably in `uint256`.

### 2.4 Exact Output Swap (`getAmountIn`)

Given an exact desired output $\text{amountOut}$, compute the gross input $\text{amountIn}$ that the trader must provide.

1. **Step 1: Compute Required Net Input ($\text{amountInNet}$)**
   $$(\text{reserveIn} + \text{amountInNet})(\text{reserveOut} - \text{amountOut}) \ge \text{reserveIn} \cdot \text{reserveOut}$$
   $$\text{amountInNet} = \left\lceil \frac{\text{reserveIn} \cdot \text{amountOut}}{\text{reserveOut} - \text{amountOut}} \right\rceil = \left\lfloor \frac{\text{reserveIn} \cdot \text{amountOut}}{\text{reserveOut} - \text{amountOut}} \right\rfloor + 1$$

2. **Step 2: Account for Fee to Compute Gross Input ($\text{amountInGross}$)**
   Since $\text{amountInAfterFee} = \text{amountInGross} - \text{feeAmount} \ge \text{amountInNet}$:
   $$\text{amountInGross} \cdot \frac{\text{FEE\_DENOMINATOR} - \text{fee}}{\text{FEE\_DENOMINATOR}} \ge \text{amountInNet}$$
   $$\text{amountInGross} = \left\lceil \frac{\text{amountInNet} \cdot \text{FEE\_DENOMINATOR}}{\text{FEE\_DENOMINATOR} - \text{fee}} \right\rceil$$

**Full Pseudocode:**
```
function getAmountIn(amountOut, reserveIn, reserveOut, fee):
    require(amountOut > 0, "InsufficientOutputAmount")
    require(reserveIn > 0 and reserveOut > 0, "InsufficientLiquidity")
    require(amountOut < reserveOut, "InsufficientLiquidity")

    // Net input required (round UP)
    numeratorNet = reserveIn * amountOut
    denominatorNet = reserveOut - amountOut
    amountInNet = (numeratorNet / denominatorNet) + 1

    // Gross input required with fee (round UP)
    feeComplement = FEE_DENOMINATOR - fee
    numeratorGross = amountInNet * FEE_DENOMINATOR
    amountInGross = (numeratorGross + feeComplement - 1) / feeComplement   // round UP

    return amountInGross
```

- **Rounding Direction:** Round **UP** on both intermediate net input and gross input.
- **Economic Rationale:** Ensures the trader provides sufficient gross tokens so that after rounding up the fee deduction, the net tokens entering the pool strictly satisfy the invariant.
- **Verification Guarantee:** Let $f_{\text{act}} = \lceil \text{amountInGross} \cdot \text{fee} / \text{FEE\_DENOMINATOR} \rceil$. Then $\text{amountInGross} - f_{\text{act}} \ge \text{amountInNet}$.

### 2.5 Invariant Preservation ($k$-Check)

Following every swap, the pool explicitly validates that the product of updated reserves (excluding protocol fees) is greater than or equal to the previous product:

$$k_{\text{new}} \ge k_{\text{old}} \iff \text{reserve0}_{\text{new}} \cdot \text{reserve1}_{\text{new}} \ge \text{reserve0}_{\text{old}} \cdot \text{reserve1}_{\text{old}}$$

Because the fee remains in the reserves (or is accounted into protocol fee balances), and rounding directions always favor the pool, $k$ increases by approximately:
$$\Delta k \approx \text{feeAmount} \cdot \text{reserve}_{\text{other}}$$

---

## 4. §3: Reserve Update Order and Safety

### 3.1 Checks-Effects-Interactions (CEI) Pattern

All state-changing operations strictly adhere to the Checks-Effects-Interactions pattern to eliminate reentrancy vulnerabilities:

```
+-------------------------------------------------------------+
| 1. CHECKS                                                   |
|    - Validate function arguments (amountIn > 0, etc.)       |
|    - Check reserves > 0 and amountOut < reserveOut          |
|    - Validate recipient != token0 && recipient != token1    |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| 2. EFFECTS (State Modifications)                            |
|    - Accumulate protocol fees (if enabled)                  |
|    - Update TWAP oracle accumulators                        |
|    - Overwrite reserve0 and reserve1 in storage             |
|    - Emit events (Swap, Mint, Burn, Sync)                   |
+-------------------------------------------------------------+
                               |
                               v
+-------------------------------------------------------------+
| 3. INTERACTIONS (External Calls)                            |
|    - Transfer tokens to recipient via SafeTransfer          |
+-------------------------------------------------------------+
```

### 3.2 External Call Isolation & Callbacks

Per protocol safety guidelines:
- OmniFi V2 does **not** permit arbitrary external callbacks, custom hook execution, or flash loan callbacks to untrusted contracts.
- Token transfers are performed strictly to verified recipients via standard safe transfer patterns.
- Token contracts with reentrancy side-effects (e.g., ERC-777 tokens) are prohibited per [ADR-006](../adr/ADR-006-token-policy.md).

### 3.3 Reentrancy Protection

Every state-changing function (`swap`, `mint`, `burn`, `sync`, `skim`) utilizes a non-reentrant mutex guard:

```
uint256 private constant _NOT_ENTERED = 1;
uint256 private constant _ENTERED = 2;
uint256 private _status;

modifier nonReentrant() {
    require(_status != _ENTERED, "Locked");
    _status = _ENTERED;
    _;
    _status = _NOT_ENTERED;
}
```

### 3.4 Minimum Liquidity Protection

To eliminate the classic **first-depositor share price manipulation attack** (where a malicious actor mints a single unit of liquidity and donates tokens to inflate the LP share price to render subsequent deposits subject to severe rounding loss), the pool enforces:

$$\text{MINIMUM\_LIQUIDITY} = 1000$$

- On the very first deposit, $\text{MINIMUM\_LIQUIDITY}$ LP tokens are permanently minted to `address(0)` (or dead address `0x000000000000000000000000000000000000dEaD`).
- These units can never be redeemed, establishing an immutable minimum total supply:
  $$\text{totalSupply} \ge 1000 \quad \forall \text{ initialized pools}$$

### 3.5 State Boundary Invariants

At the conclusion of every execution:
1. $\text{reserve0} > 0$ and $\text{reserve1} > 0$
2. $\text{reserve0} \le \text{type(uint112).max}$ and $\text{reserve1} \le \text{type(uint112).max}$
3. $\text{balance0} \ge \text{reserve0} + \text{unclaimedProtocolFee0}$
4. $\text{balance1} \ge \text{reserve1} + \text{unclaimedProtocolFee1}$

---

## 5. §4: Add/Remove Liquidity and LP Token Math

OmniFi V2 pools issue standard ERC-20 compliant LP tokens representing proportional ownership of pool reserves.

### 4.1 First Liquidity Deposit

For the initial deposit of amounts $\text{amount0}$ and $\text{amount1}$ when $\text{totalSupply} == 0$:

$$\text{liquidityInitial} = \lfloor \sqrt{\text{amount0} \cdot \text{amount1}} \rfloor$$
$$\text{liquidityToMinter} = \text{liquidityInitial} - \text{MINIMUM\_LIQUIDITY}$$

**Pseudocode:**
```
function computeInitialLiquidity(amount0, amount1):
    require(amount0 > 0 and amount1 > 0, "InsufficientInputAmount")
    
    product = amount0 * amount1
    liquidityInitial = integerSqrt(product)                         // round DOWN
    
    require(liquidityInitial > MINIMUM_LIQUIDITY, "InsufficientLiquidity")
    
    mint(address(0), MINIMUM_LIQUIDITY)                             // permanently locked
    liquidityToMinter = liquidityInitial - MINIMUM_LIQUIDITY
    return liquidityToMinter
```

- **Rounding Direction:** Round **DOWN** (integer square root).
- **Overflow Analysis:** Product $\text{amount0} \cdot \text{amount1}$ fits in `uint256` for amounts up to $2^{112} - 1$. Max product $\approx 2^{224} < 2^{256} - 1$.

#### Babylonian Integer Square Root Algorithm
```
function integerSqrt(y):
    if y > 3:
        z = y
        x = (y / 2) + 1
        while x < z:
            z = x
            x = (y / x + x) / 2
        return z
    else if y != 0:
        return 1
    else:
        return 0
```
*Note:* The Babylonian algorithm with integer division computes $\lfloor \sqrt{y} \rfloor$ exactly.

### 4.2 Subsequent Liquidity Deposits

For deposits when $\text{totalSupply} > 0$, depositors must contribute assets proportional to existing reserves. Liquidity minted is determined by the asset that contributes the smaller proportional share:

$$\text{liquidity0} = \left\lfloor \frac{\text{amount0} \cdot \text{totalSupply}}{\text{reserve0}} \right\rfloor$$
$$\text{liquidity1} = \left\lfloor \frac{\text{amount1} \cdot \text{totalSupply}}{\text{reserve1}} \right\rfloor$$
$$\text{liquidity} = \min(\text{liquidity0}, \text{liquidity1})$$

**Pseudocode:**
```
function computeSubsequentLiquidity(amount0, amount1, reserve0, reserve1, totalSupply):
    require(amount0 > 0 and amount1 > 0, "InsufficientInputAmount")
    require(reserve0 > 0 and reserve1 > 0, "InsufficientLiquidity")

    liquidity0 = (amount0 * totalSupply) / reserve0                  // round DOWN
    liquidity1 = (amount1 * totalSupply) / reserve1                  // round DOWN

    liquidity = min(liquidity0, liquidity1)
    require(liquidity > 0, "InsufficientLiquidity")
    return liquidity
```

- **Rounding Direction:** Round **DOWN**.
- **Economic Rationale:** Truncation guarantees the depositor is credited with at most their fair share of pool equity. Any imbalance between $\text{amount0}/\text{reserve0}$ and $\text{amount1}/\text{reserve1}$ acts as an uncredited surplus that remains in the pool.
- **Overflow Analysis:**
  - $\text{amount0} \cdot \text{totalSupply}$: In a pool where $\text{amount0} \le 2^{112} - 1$ and $\text{totalSupply} \le 2^{112} - 1$, product $\le 2^{224} < 2^{256} - 1$.
  - Fits within standard 256-bit word without intermediate overflow.

### 4.3 Liquidity Removal

When burning $\text{liquidity}$ LP tokens, the holder receives proportional amounts of both underlying reserves:

$$\text{amount0} = \left\lfloor \frac{\text{liquidity} \cdot \text{reserve0}}{\text{totalSupply}} \right\rfloor$$
$$\text{amount1} = \left\lfloor \frac{\text{liquidity} \cdot \text{reserve1}}{\text{totalSupply}} \right\rfloor$$

**Pseudocode:**
```
function computeLiquidityRemoval(liquidity, reserve0, reserve1, totalSupply):
    require(liquidity > 0, "InsufficientInputAmount")
    require(totalSupply >= liquidity, "InsufficientLiquidity")

    amount0 = (liquidity * reserve0) / totalSupply                   // round DOWN
    amount1 = (liquidity * reserve1) / totalSupply                   // round DOWN

    require(amount0 > 0 and amount1 > 0, "InsufficientOutputAmount")
    return (amount0, amount1)
```

- **Rounding Direction:** Round **DOWN**.
- **Economic Rationale:** The withdrawing LP receives at most their exact proportional share. Truncation dust remains inside the pool, marginally increasing the value backing the remaining LP shares.
- **Reserve Updates:**
  $$\text{reserve0}_{\text{new}} = \text{reserve0} - \text{amount0}$$
  $$\text{reserve1}_{\text{new}} = \text{reserve1} - \text{amount1}$$
  $$\text{totalSupply}_{\text{new}} = \text{totalSupply} - \text{liquidity}$$

---

## 6. §5: Protocol Fee Accounting

### 5.1 Architecture: Counter Accumulation vs. LP Dilution

> [!NOTE]
> **OmniFi Protocol Fee Design**  
> Unlike Uniswap V2 (which lazily minted LP tokens on deposit/withdrawal using a non-linear geometric mean formula $\sqrt{k}$), OmniFi V2 uses **direct integer fee counter accumulation** on each swap:
> 1. Eliminates complex square-root evaluations on mint/burn.
> 2. Prevents unexpected LP dilution during periods of high price volatility.
> 3. Does not alter LP token supply or reserve pricing ratios.

### 5.2 Fee Fraction Configuration

Per [ADR-007](../adr/ADR-007-economic-parameters.md) and [Fee and Rounding Specification](fee-and-rounding-spec.md) §3:
- Denominator: `PROTOCOL_FEE_DENOMINATOR = 4`
- Allowed values for `protocolFeeFraction`:
  - `0`: Protocol fee is disabled (100% of swap fee to LPs)
  - `1`: Protocol fee is 25% of total swap fee (75% to LPs)
- Range: $0 \le \text{protocolFeeFraction} \le 1$
- Initial launch setting: `0` (protocol fee OFF).

### 5.3 Swap-Time Accounting

When a swap occurs with gross fee `feeAmount` on the input token:

$$\text{protocolFee} = \left\lfloor \frac{\text{feeAmount} \cdot \text{protocolFeeFraction}}{\text{PROTOCOL\_FEE\_DENOMINATOR}} \right\rfloor$$
$$\text{lpFee} = \text{feeAmount} - \text{protocolFee}$$

**Pseudocode:**
```
function accountProtocolFee(tokenIn, feeAmount):
    if protocolFeeFraction > 0:
        protocolFee = (feeAmount * protocolFeeFraction) / PROTOCOL_FEE_DENOMINATOR  // round DOWN
        protocolFees[tokenIn] += protocolFee
        return protocolFee
    return 0
```

- **Rounding Direction:** Round **DOWN** (truncation).
- **Economic Rationale:** Truncation strictly favors LPs over the protocol in the event of non-divisible fractional units.
- **Reserve Separation:**
  The `protocolFee` is added to a dedicated storage counter `protocolFees[tokenIn]`. It is **excluded** from `reserveIn` so it does not back LP tokens or contribute to constant-product liquidity calculations.

### 5.4 Protocol Fee Collection

Collection is a segregated administrative operation and never occurs during regular swaps:

```
function collectProtocolFees(address recipient, uint256 amount0Requested, uint256 amount1Requested):
    require(msg.sender == factory.feeRecipient(), "Unauthorized")
    
    amount0 = min(amount0Requested, protocolFees[token0])
    amount1 = min(amount1Requested, protocolFees[token1])
    
    protocolFees[token0] -= amount0
    protocolFees[token1] -= amount1
    
    if amount0 > 0:
        safeTransfer(token0, recipient, amount0)
    if amount1 > 0:
        safeTransfer(token1, recipient, amount1)
        
    emit ProtocolFeeCollected(recipient, amount0, amount1)
```

### 5.5 Governance & Timelock Constraints

Per [ADR-011](../adr/ADR-011-admin-custody.md):
- Updating `protocolFeeFraction` or `feeRecipient` requires:
  1. Proposal by the Protocol Admin Multisig.
  2. A mandatory **48-hour timelock delay**.
  3. Execution after timelock expiry.
- Parameter boundaries: `newFraction <= 1` (maximum 25% fee share).

---

## 7. §6: Donation and Sync Behavior

### 7.1 Balance vs. Reserve Divergence

A pair holds real ERC-20 balances in its contract:
$$\text{balance0} = \text{token0.balanceOf}(\text{pair}), \quad \text{balance1} = \text{token1.balanceOf}(\text{pair})$$

Under normal operation:
$$\text{balance0} = \text{reserve0} + \text{protocolFees}[\text{token0}]$$
$$\text{balance1} = \text{reserve1} + \text{protocolFees}[\text{token1}]$$

Divergence occurs when:
1. Tokens are directly transferred (donated) to the pair without calling `mint` or `swap`.
2. A trade transaction over-transfers tokens.
3. Tokens with non-standard distribution or fee-on-transfer are transferred (prohibited by ADR-006, but handled defensively).

### 7.2 Resolution: `sync()`

The `sync()` function forces stored reserves to equal current contract balances minus accrued protocol fees:

```
function sync() nonReentrant:
    balance0 = token0.balanceOf(address(this))
    balance1 = token1.balanceOf(address(this))

    available0 = balance0 - protocolFees[token0]
    available1 = balance1 - protocolFees[token1]

    require(available0 <= type(uint112).max and available1 <= type(uint112).max, "Overflow")

    updateOracle(available0, available1, reserve0, reserve1)
    emit Sync(reserve0, reserve1)
```

- **Impact of Direct Donation:**
  If an external party sends tokens directly to the contract and calls `sync()`, `reserve0` or `reserve1` increases without changing `totalSupply`.
  - The ratio $\text{reserve} / \text{totalSupply}$ increases for both assets.
  - All existing LP token holders gain value equally and proportionally.
  - Thanks to the locked $\text{MINIMUM\_LIQUIDITY}$, malicious actors cannot execute a share inflation attack cheaply.

### 7.3 Resolution: `skim()`

The `skim()` function recovers uncommitted tokens (surplus above stored reserves and accrued protocol fees) and sends them to a designated address:

```
function skim(address to) nonReentrant:
    require(to != token0 and to != token1, "InvalidTo")
    require(to != address(0), "ZeroAddress")

    balance0 = token0.balanceOf(address(this))
    balance1 = token1.balanceOf(address(this))

    expected0 = uint256(reserve0) + protocolFees[token0]
    expected1 = uint256(reserve1) + protocolFees[token1]

    excess0 = balance0 > expected0 ? balance0 - expected0 : 0
    excess1 = balance1 > expected1 ? balance1 - expected1 : 0

    if excess0 > 0:
        safeTransfer(token0, to, excess0)
    if excess1 > 0:
        safeTransfer(token1, to, excess1)
```

---

## 8. §7: Events and Custom Errors

To optimize gas and ensure comprehensive observability, OmniFi V2 specifies indexed EVM logs and Solidity custom errors (instead of string revert reasons).

### 8.1 Events

```
// Emitted upon successful execution of a swap
event Swap(
    address indexed sender,
    uint256 amount0In,
    uint256 amount1In,
    uint256 amount0Out,
    uint256 amount1Out,
    address indexed to
);

// Emitted when liquidity is minted
event Mint(
    address indexed sender,
    uint256 amount0,
    uint256 amount1,
    uint256 liquidity,
    address indexed to
);

// Emitted when liquidity is burned
event Burn(
    address indexed sender,
    uint256 amount0,
    uint256 amount1,
    uint256 liquidity,
    address indexed to
);

// Emitted when reserves are forced to match balances
event Sync(
    uint112 reserve0,
    uint112 reserve1
);

// Emitted when protocol fees are claimed by the fee recipient
event ProtocolFeeCollected(
    address indexed recipient,
    uint256 amount0,
    uint256 amount1
);

// Emitted when protocol fee fraction is updated
event ProtocolFeeFractionUpdated(
    uint8 oldFraction,
    uint8 newFraction
);
```

### 8.2 Custom Errors

| Error Signature | Condition |
|---|---|
| `InsufficientLiquidity()` | Pool reserves are 0, or LP tokens to mint/burn round to 0, or swap output exceeds reserve |
| `InsufficientInputAmount()` | Swap input amount or liquidity deposit amount is 0 |
| `InsufficientOutputAmount()` | Swap output amount or liquidity withdraw amount is 0, or slippage `amountOutMin` violated |
| `ExcessiveInputAmount()` | Swap exact output requires gross input exceeding `amountInMax` |
| `InvalidTo()` | Recipient address is set to `address(0)` or to either underlying token contract |
| `Overflow()` | Reserve balance exceeds `type(uint112).max` |
| `Locked()` | Reentrancy guard is active |
| `IdenticalAddresses()` | Attempting to deploy pair with identical token addresses |
| `ZeroAddress()` | Parameter passed with zero address where forbidden |
| `PairExists()` | Pair for given token pair already registered in factory |
| `Unauthorized()` | Sender lacks administrative authority |
| `ExceedsMaxProtocolFee()` | Attempting to set protocol fee fraction $> 1$ (25%) |
| `Expired()` | Transaction executed after deadline timestamp |

---

## 9. §8: Router and Multi-Hop Execution

The `OmniFiV2Router` coordinates trade paths across one or more pools.

### 9.1 Multi-Hop Exact Input (`swapExactTokensForTokens`)

Given a trade path $[T_0, T_1, \dots, T_n]$:
1. Let $A_0 = \text{amountIn}$.
2. For each step $i \in [0, n-1]$:
   - Identify pool for $(T_i, T_{i+1})$.
   - Compute $A_{i+1} = \text{getAmountOut}(A_i, \text{reserveIn}_i, \text{reserveOut}_i, \text{fee}_i)$.
3. Enforce slippage:
   $$\text{require}(A_n \ge \text{amountOutMin}, \text{"InsufficientOutputAmount"})$$
4. Enforce deadline:
   $$\text{require}(\text{block.timestamp} \le \text{deadline}, \text{"Expired"})$$
5. Transfer $A_0$ from trader to first pair, then execute sequential swaps chaining each pair's output directly to the next pair (or recipient on the final hop).

### 9.2 Multi-Hop Exact Output (`swapTokensForExactTokens`)

Given a trade path $[T_0, T_1, \dots, T_n]$:
1. Let $A_n = \text{amountOut}$.
2. Traverse backwards for each step $i \in [n-1, 0]$:
   - Compute $A_i = \text{getAmountIn}(A_{i+1}, \text{reserveIn}_i, \text{reserveOut}_i, \text{fee}_i)$.
3. Enforce slippage:
   $$\text{require}(A_0 \le \text{amountInMax}, \text{"ExcessiveInputAmount"})$$
4. Enforce deadline:
   $$\text{require}(\text{block.timestamp} \le \text{deadline}, \text{"Expired"})$$
5. Transfer $A_0$ from trader to first pair, then execute sequential swaps.

---

## 10. Arithmetic Reference & Overflow Analysis

### 10.1 Master Arithmetic & Rounding Summary

| Operation | Formula | Rounding | Implementation Expression |
|---|---|---|---|
| **Fee on Input** | $\frac{\text{amountIn} \cdot \text{fee}}{\text{DENOM}}$ | UP | `(amountIn * fee + DENOM - 1) / DENOM` |
| **Exact Input Output** | $\frac{\text{reserveOut} \cdot \text{amountInAfterFee}}{\text{reserveIn} + \text{amountInAfterFee}}$ | DOWN | `(reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee)` |
| **Exact Output Net Input** | $\frac{\text{reserveIn} \cdot \text{amountOut}}{\text{reserveOut} - \text{amountOut}}$ | UP | `(reserveIn * amountOut) / (reserveOut - amountOut) + 1` |
| **Exact Output Gross Input** | $\frac{\text{amountInNet} \cdot \text{DENOM}}{\text{DENOM} - \text{fee}}$ | UP | `(amountInNet * DENOM + (DENOM - fee) - 1) / (DENOM - fee)` |
| **Initial LP Mint** | $\sqrt{\text{amount0} \cdot \text{amount1}} - 1000$ | DOWN | `integerSqrt(amount0 * amount1) - 1000` |
| **Subsequent LP Mint** | $\min(\frac{a_0 \cdot S}{R_0}, \frac{a_1 \cdot S}{R_1})$ | DOWN | `min((a0 * S) / R0, (a1 * S) / R1)` |
| **Burn Liquidity Amount** | $\frac{L \cdot R}{S}$ | DOWN | `(liquidity * reserve) / totalSupply` |
| **Protocol Fee Split** | $\frac{\text{feeAmount} \cdot \text{fraction}}{\text{DENOM\_PROTO}}$ | DOWN | `(feeAmount * fraction) / DENOM_PROTO` |

### 10.2 Bitwidth and Overflow Bounds

| Expression | Variable Types | Max Component Value | Max Intermediate Product | Max Permissible Type | Safe? |
|---|---|---|---|---|---|
| `amountIn * fee` | `amountIn`: `uint112`<br>`fee`: `uint24` | $5.19 \times 10^{33}$<br>$1 \times 10^6$ | $5.19 \times 10^{39} \approx 2^{132}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** ($\approx 10^{38}$ safety factor) |
| `reserveOut * amountInAfterFee` | Both `uint112` | $5.19 \times 10^{33}$ | $2.69 \times 10^{67} \approx 2^{224}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** ($\approx 4 \times 10^{9}$ safety factor) |
| `reserveIn * amountOut` | Both `uint112` | $5.19 \times 10^{33}$ | $2.69 \times 10^{67} \approx 2^{224}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** ($\approx 4 \times 10^{9}$ safety factor) |
| `amount0 * amount1` (Initial LP) | Both `uint112` | $5.19 \times 10^{33}$ | $2.69 \times 10^{67} \approx 2^{224}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** |
| `amount * totalSupply` | Both `uint112` | $5.19 \times 10^{33}$ | $2.69 \times 10^{67} \approx 2^{224}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** |
| `liquidity * reserve` | Both `uint112` | $5.19 \times 10^{33}$ | $2.69 \times 10^{67} \approx 2^{224}$ | `uint256` ($1.15 \times 10^{77}$) | **Yes** |

### 10.3 Proof of Invariant Non-Decreasing Property ($k$-Monotonicity)

**Theorem:** Under truncating integer division for $\text{amountOut}$ and ceiling division for $\text{feeAmount}$, $k_{\text{after}} \ge k_{\text{before}}$ for all valid swaps.

*Proof:*
Let initial reserves be $R_{\text{in}}, R_{\text{out}}$.  
Let gross input be $a_{\text{in}} > 0$.  
Fee deducted is $f = \lceil \frac{a_{\text{in}} \cdot \text{fee}}{\text{DENOM}} \rceil \ge \frac{a_{\text{in}} \cdot \text{fee}}{\text{DENOM}}$.  
Net input entering the reserves is $a_{\text{net}} = a_{\text{in}} - f$.  
Net input with fee retained in the pool is $a_{\text{eff}} = a_{\text{in}} - f_{\text{proto}}$, where $f_{\text{proto}} \le \frac{f}{4}$. Thus $a_{\text{eff}} \ge a_{\text{net}}$.

The output paid to trader is:
$$a_{\text{out}} = \left\lfloor \frac{R_{\text{out}} \cdot a_{\text{net}}}{R_{\text{in}} + a_{\text{net}}} \right\rfloor \le \frac{R_{\text{out}} \cdot a_{\text{net}}}{R_{\text{in}} + a_{\text{net}}}$$

New reserves are:
$$R_{\text{in}}^{\prime} = R_{\text{in}} + a_{\text{eff}} \ge R_{\text{in}} + a_{\text{net}}$$
$$R_{\text{out}}^{\prime} = R_{\text{out}} - a_{\text{out}} \ge R_{\text{out}} - \frac{R_{\text{out}} \cdot a_{\text{net}}}{R_{\text{in}} + a_{\text{net}}} = \frac{R_{\text{out}} \cdot R_{\text{in}}}{R_{\text{in}} + a_{\text{net}}}$$

Computing the new product $k^{\prime}$:
$$k^{\prime} = R_{\text{in}}^{\prime} \cdot R_{\text{out}}^{\prime} \ge (R_{\text{in}} + a_{\text{net}}) \cdot \frac{R_{\text{out}} \cdot R_{\text{in}}}{R_{\text{in}} + a_{\text{net}}} = R_{\text{in}} \cdot R_{\text{out}} = k$$

Since both inequalities ($a_{\text{eff}} \ge a_{\text{net}}$ and truncation on $a_{\text{out}}$) are non-negative, $k^{\prime} \ge k$ holds strictly for all integers. $\blacksquare$
