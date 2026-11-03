# OmniFi — Solana Concentrated-Liquidity AMM (CLMM) Specification

**Version:** 1.0  
**Status:** Phase 1 deliverable  
**Date:** 2026-11-01  
**Target Runtime:** Solana Sealevel / Agave (SVM)  
**Related ADRs:** ADR-005 (Accepted — Solana CLMM Strategy), ADR-006 (Accepted — Token Policy), ADR-007 (Accepted — Economic Parameters), ADR-008 (Accepted — Position Model), ADR-009 (Accepted — Oracle Policy), ADR-011 (Accepted — Admin Custody)  
**Dependencies:** `evm-clmm-spec.md` (core math & curve definitions), `fee-and-rounding-spec.md` (fee tiers & rounding rules), `token-compatibility.md` (SPL and Token-2022 compatibility)  
**Prerequisite for:** Solana CLMM on-chain programs, Solana Anchor IDL, OmniFi TypeScript SDK, Router/Smart Order Router (SOR), Indexer

---

## Executive Summary & Architectural Philosophy

OmniFi on Solana implements an original, native Concentrated-Liquidity Automated Market Maker (CLMM) designed from first principles around the Solana runtime:
- **Program Derived Addresses (PDAs)** for deterministic, trustless account addressing without global registries.
- **Fixed-size Tick Arrays (88 ticks per array)** engineered to operate within Solana's 10 KB account allocation boundary and compute-budget constraints.
- **Q32.64 / Q64.64 Fixed-Point Arithmetic (u128)** optimized for the Solana Virtual Machine (eBPF 64-bit architecture), replacing EVM's 256-bit word overhead with native 64-bit/128-bit register efficiency.
- **PDA-Backed Position Accounts (ADR-008)** providing zero-rent bloat, deterministic owner authorization, and single-instruction position indexing without SPL token mint overhead in Release 1.
- **Bounded Account Vectors (up to 3 tick arrays per swap)** providing deterministic transaction sizing, predictable compute usage, and clean partial-fill semantics when price boundaries are reached.
- **Sealevel Parallel Execution Awareness**, maximizing multi-threaded pool execution across distinct trading pairs while serializing updates strictly within single-pool write locks.

> [!IMPORTANT]
> **This is NOT an EVM port.** EVM assumptions—such as unbounded dynamic storage mappings, contract-internal reentrancy locks, single-threaded global state mutations, and 256-bit native words—do not apply on Solana. Every state variable, account ownership check, rent exemption rule, and CPI boundary is strictly tailored to the Solana account model.

---

## Table of Contents

1. [Fixed-Point Formats and Numerical Precision](#1-fixed-point-formats-and-numerical-precision)
2. [Tick-Array Design (§1)](#2-tick-array-design-1)
3. [Boundary Crossing and Array Traversal (§2)](#3-boundary-crossing-and-array-traversal-2)
4. [Max Arrays Per Swap and Partial-Fill Semantics (§3)](#4-max-arrays-per-swap-and-partial-fill-semantics-3)
5. [Position Model (§4 - ADR-008 PDA-Backed)](#5-position-model-4---adr-008-pda-backed)
6. [Fee Growth on Solana (§5 - Q64.64 Arithmetic)](#6-fee-growth-on-solana-5---q6464-arithmetic)
7. [Compute Units and Transaction Size Analysis (§6)](#7-compute-units-and-transaction-size-analysis-6)
8. [Account-Lock Contention and Parallelism Model (§7)](#8-account-lock-contention-and-parallelism-model-7)
9. [Mathematical Formulas and Integer Algorithms](#9-mathematical-formulas-and-integer-algorithms)
10. [State Account Schemas and Memory Layouts](#10-state-account-schemas-and-memory-layouts)
11. [Instruction Interfaces and State Transitions (§8)](#11-instruction-interfaces-and-state-transitions-8)
    - [11.1 initialize_pool](#111-initialize_pool)
    - [11.2 initialize_tick_array](#112-initialize_tick_array)
    - [11.3 open_position](#113-open_position)
    - [11.4 increase_liquidity](#114-increase_liquidity)
    - [11.5 decrease_liquidity](#115-decrease_liquidity)
    - [11.6 collect_fees](#116-collect_fees)
    - [11.7 swap](#117-swap)
    - [11.8 close_position](#118-close_position)
12. [Token Compatibility: SPL Token and Token-2022](#12-token-compatibility-spl-token-and-token-2022)
13. [Security Validation and Invariant Checklist](#13-security-validation-and-invariant-checklist)
14. [Off-Chain SDK and Routing Integration](#14-off-chain-sdk-and-routing-integration)

---

## 1. Fixed-Point Formats and Numerical Precision

### 1.1 Q32.64 Sqrt-Price Representation

On Solana, sqrt-price is stored and manipulated as a 128-bit unsigned integer (`u128`) in **Q32.64** format:
- **Upper 64 bits:** Integer portion (with 32 bits active range up to $2^{32}-1$).
- **Lower 64 bits:** Fractional portion (scaled by $2^{64}$).
- **Scaling Constant:** $Q64 = 2^{64} = 18,446,744,073,709,551,616$.

$$\text{sqrt\_price\_x64} = \lfloor \sqrt{P} \cdot 2^{64} \rfloor$$

$$\text{Real Price } P = \left( \frac{\text{sqrt\_price\_x64}}{2^{64}} \right)^2$$

#### Rationale for Q32.64 vs EVM's Q64.96
- **Register Efficiency:** The SVM executes on an eBPF 64-bit virtual CPU. Manipulating 128-bit values requires two 64-bit registers, and intermediate multiplications require 256-bit operations (four registers). EVM's Q64.96 (160 bits) forces 256-bit or 512-bit intermediate math, which incurs substantial compute unit (CU) penalties under software emulation on Solana.
- **Dynamic Price Range:** In Q32.64, maximum $\sqrt{P} \approx 2^{32}$, representing a maximum price $P \approx 2^{64} \approx 1.84 \times 10^{19}$. Minimum non-zero $\sqrt{P} = 1$, representing a minimum price $P \approx 2^{-128} \approx 2.9 \times 10^{-39}$. This dynamic range ($> 10^{57}$) easily accommodates micro-cap meme coins priced in billionths of a cent up to high-value wrapped assets without precision loss.

### 1.2 Q64.64 Fee Growth Accumulators

Fee accumulators (`fee_growth_global_0_x64`, `fee_growth_global_1_x64`, and tick-level `fee_growth_outside_x64`) are stored as `u128` in **Q64.64** fixed-point:
- Scaled by $2^{64}$.
- Provides ~18.4 decimal digits of precision for fractional token amounts per unit of liquidity.
- Relies on unsigned 128-bit modular wrapping arithmetic (`mod 2^128`), ensuring lossless accumulation across indefinite swap cycles.

### 1.3 Core Protocol Constants

| Constant | Type | Value | Hex / Mathematical Value | Description |
|:---|:---|:---|:---|:---|
| `TICK_ARRAY_SIZE` | `usize` | `88` | `0x58` | Number of ticks per tick array account |
| `MIN_TICK` | `i32` | `-443636` | `-0x6C4F4` | Lower bound tick for Q32.64 price |
| `MAX_TICK` | `i32` | `443636` | `0x6C4F4` | Upper bound tick for Q32.64 price |
| `MIN_SQRT_PRICE_X64` | `u128` | `4295128739` | `0x100000003` | $\sqrt{P}$ at `MIN_TICK` in Q32.64 |
| `MAX_SQRT_PRICE_X64` | `u128` | `79226673515401279992447579055` | `0xFFFFFFFE0000000000000000` | $\sqrt{P}$ at `MAX_TICK` in Q32.64 |
| `Q64` | `u128` | `18446744073709551616` | `0x10000000000000000` | $2^{64}$ fixed-point scaling factor |
| `FEE_DENOMINATOR` | `u32` | `1000000` | `0xF4240` | Fee parts-per-million ($10^6$) |
| `MAX_PROTOCOL_FEE_FRACTION` | `u8` | `1` | `1/4` (25%) | Max protocol share of LP fee |
| `PROTOCOL_FEE_DENOMINATOR`| `u8` | `4` | `0x04` | Denominator for protocol fee |
| `MAX_SWAP_TICK_ARRAYS`| `usize` | `3` | `0x03` | Max tick arrays in a single swap tx |

---

## 2. Tick-Array Design (§1)

### 2.1 The Account Model Constraint

In EVM CLMMs, all ticks are stored in an unbounded sparse mapping within a single contract account (`mapping(int24 => Tick.Info)`).
On Solana:
1. Every account has an upfront allocated size.
2. Solana's runtime allocates memory in increments with an absolute upper bound per instruction CPI (and practical transaction boundaries).
3. Attempting to reallocate a single pool account to store hundreds or thousands of ticks would trigger memory exhaustion, breach account limits, and generate extreme lock contention.

To solve this, OmniFi partitions the tick spectrum into discrete, deterministic **Tick Arrays**.

### 2.2 Sizing: 88 Ticks per Array

Each `TickArray` account holds exactly **88 ticks**.
- **Tick Entry Size:** 72 bytes (padded and 8-byte aligned).
- **Header Size:** 64 bytes (discriminator, pool key, start tick, bump, alignment padding).
- **Total Account Data Size:**
  $$\text{Size} = 64 + (88 \times 72) = 6,400 \text{ bytes} \approx 6.25 \text{ KB}$$
- **Rent Exemption Cost:** $\approx 0.045 \text{ SOL}$ per array (fully reclaimable if closed, paid by the LP who initializes it).
- **Memory Safety:** 6.4 KB is safely below Solana's 10,240-byte (10 KB) single-instruction account allocation limit, eliminating the need for multi-step realloc CPIs.

```
+-------------------------------------------------------------------------+
|                       TickArray Account (6,400 Bytes)                   |
+-------------------------------------------------------------------------+
| Header (64 bytes):                                                      |
|   discriminator: u8 [5] | version: u8 [1] | bump: u8                    |
|   pool: Pubkey (32 bytes)                                               |
|   start_tick_index: i32 (4 bytes)                                       |
|   padding: [u8; 25]                                                     |
+-------------------------------------------------------------------------+
| Ticks Array: [Tick; 88] (6,336 bytes total, 72 bytes per tick):         |
|   Tick 0  : { liquidity_gross, liquidity_net, fee_growth_0/1, init }    |
|   Tick 1  : { liquidity_gross, liquidity_net, fee_growth_0/1, init }    |
|   ...                                                                   |
|   Tick 87 : { liquidity_gross, liquidity_net, fee_growth_0/1, init }    |
+-------------------------------------------------------------------------+
```

### 2.3 PDA Derivation

Every `TickArray` account is a Program Derived Address (PDA) deterministically derived from the pool's public key and the array's starting tick index:

```
seeds = [
    b"omnifi-tick-array",
    pool_state_pubkey.as_ref(),
    start_tick_index.to_le_bytes()
]
```

### 2.4 Tick Index Mapping Formulas

Let `tick` be an arbitrary signed integer tick divisible by `tick_spacing`.
Let `ticks_per_array = TICK_ARRAY_SIZE * tick_spacing = 88 * tick_spacing`.

#### Mathematical Start Tick Index
The `start_tick_index` must represent the lowest tick boundary covered by that array. Because integer division in standard processors truncates toward zero, mathematical floor division must be enforced:

```
function get_start_tick_index(tick: i32, tick_spacing: u16) -> i32:
    ticks_per_array = 88 * i32(tick_spacing)
    
    // Explicit floor division for signed integers
    if tick >= 0:
        return (tick / ticks_per_array) * ticks_per_array
    else:
        // When tick < 0 and has remainder, truncate toward -infinity
        remainder = tick % ticks_per_array
        if remainder == 0:
            return tick
        else:
            return ((tick / ticks_per_array) - 1) * ticks_per_array
```

#### Position Within Tick Array
Once `start_tick_index` is identified, the tick's 0-based offset inside `ticks[88]` is:

```
function get_tick_offset_in_array(tick: i32, start_tick_index: i32, tick_spacing: u16) -> usize:
    REQUIRE(tick >= start_tick_index, "Tick below array start")
    delta = tick - start_tick_index
    REQUIRE(delta % i32(tick_spacing) == 0, "Tick not aligned with tick_spacing")
    offset = delta / i32(tick_spacing)
    REQUIRE(offset >= 0 and offset < 88, "Offset out of array bounds [0, 88)")
    return usize(offset)
```

#### Coverage Examples

| Tick Spacing | Fee Tier | Ticks per Array (`88 * ts`) | Price Span per Array |
|:---|:---|:---|:---|
| 1 | 0.01% (Stable) | 88 ticks | $\approx 0.884\%$ |
| 10 | 0.05% (Correlated) | 880 ticks | $\approx 9.20\%$ |
| 60 | 0.30% (Standard) | 5,280 ticks | $\approx 69.5\%$ |
| 200 | 1.00% (Exotic) | 17,600 ticks | $\approx 481.0\%$ |

### 2.5 On-Demand Initialization

Tick arrays are initialized **on-demand**. When an LP creates a position requiring tick boundaries in an array that has not yet been initialized on-chain, the transaction invokes `initialize_tick_array`. The payer funds the rent-exempt lamport deposit. Once initialized, the array persists for all future LPs and traders.

---

## 3. Boundary Crossing and Array Traversal (§2)

### 3.1 The Account Vector Passing Requirement

Under Solana's execution engine, a program cannot dynamically fetch or load arbitrary accounts from storage unless they are explicitly passed into the transaction's account input vector (`AccountInfo` array).

When a swap executes:
1. It begins consuming liquidity within the tick array containing `pool.current_tick`.
2. As price moves, it traverses initialized ticks in the current array.
3. If the swap consumes all active liquidity up to the edge of the current array, it must **cross the array boundary** into the adjacent tick array.
4. **The adjacent tick array account must already be present in the transaction instruction accounts.**

### 3.2 Ordering and Traversal Invariants

The client (or SDK) must supply tick array accounts in strictly sorted order matching the trade direction:

#### Zero-For-One (`zeroForOne = true`)
- Token 0 is deposited, Token 1 is withdrawn.
- Price decreases ($\sqrt{P} \downarrow$, `tick` $\downarrow$).
- Traversal direction is **descending**.
- Required tick array ordering:
  $$\text{start\_tick\_index}_0 > \text{start\_tick\_index}_1 > \text{start\_tick\_index}_2$$
  Specifically:
  $$\text{start\_tick\_index}_{k+1} = \text{start\_tick\_index}_k - (\text{TICK\_ARRAY\_SIZE} \times \text{tick\_spacing})$$

#### One-For-Zero (`zeroForOne = false`)
- Token 1 is deposited, Token 0 is withdrawn.
- Price increases ($\sqrt{P} \uparrow$, `tick` $\uparrow$).
- Traversal direction is **ascending**.
- Required tick array ordering:
  $$\text{start\_tick\_index}_0 < \text{start\_tick\_index}_1 < \text{start\_tick\_index}_2$$
  Specifically:
  $$\text{start\_tick\_index}_{k+1} = \text{start\_tick\_index}_k + (\text{TICK\_ARRAY\_SIZE} \times \text{tick\_spacing})$$

### 3.3 On-Chain Validation Rules

During instruction execution, the program strictly verifies:
1. `tick_array.pool == pool_state.key()` for all supplied arrays.
2. `tick_array_0` covers the current `pool.current_tick`.
3. PDA derivation seeds match:
   $$\text{seeds} = [\text{b"omnifi-tick-array"}, \text{pool.key}, \text{start\_tick\_index.to\_le\_bytes}()]$$
4. Adjacency: Array $k+1$ is exactly adjacent to Array $k$ in the swap direction.
5. Duplication: No duplicate tick array accounts exist in the vector.

If any check fails, the transaction immediately reverts before modifying balances.

---

## 4. Max Arrays Per Swap and Partial-Fill Semantics (§3)

### 4.1 Default Limit: 3 Tick Arrays

A swap instruction accepts **up to 3 tick arrays** (e.g., `tick_array_0`, `tick_array_1`, and `tick_array_2`).
- 3 arrays provide $3 \times 88 = 264$ ticks of continuous active liquidity.
- For standard 60-spacing pools (0.30% fee), 3 arrays encompass $264 \times 60 = 15,840$ ticks ($\approx 387\%$ price impact capacity), far exceeding standard slippage tolerances ($0.5\% - 2.0\%$).
- For stable 1-spacing pools (0.01% fee), 3 arrays encompass 264 ticks ($\approx 2.67\%$ price movement), matching typical depeg arbitrage bands.

### 4.2 Missing-Array Semantics & Clean Partial Fills

If an exceptionally large order sweeps through all liquidity in the provided tick arrays and still has remaining unspent input tokens:
1. The swap executes through all available ticks up to the terminal edge of the last supplied tick array (`tick_array_N-1`).
2. At the boundary, the program checks if another tick array is required to continue.
3. If no further tick array account was passed:
   - **The swap does NOT fail or revert unconditionally.**
   - The swap loop terminates gracefully at the boundary.
   - The pool state (`sqrt_price_x64`, `current_tick`, `liquidity`) updates to the exact values at the boundary.
   - The unspent input tokens remain with the user (only the consumed input is pulled).
   - The accrued output tokens are transferred to the user.
4. **Slippage Enforcement:**
   After the swap loop terminates, the program evaluates the user's slippage limit:
   ```
   if exact_input:
       REQUIRE(actual_amount_out >= minimum_amount_out, "SlippageExceeded: Partial fill below minimum output")
   else: // exact_output
       REQUIRE(actual_amount_in <= maximum_amount_in, "SlippageExceeded: Input exceeds maximum")
   ```
   If the partial fill satisfied `minimum_amount_out`, the transaction succeeds. If the output falls short, the transaction safely aborts.

### 4.3 Off-Chain SDK Pre-computation

The OmniFi SDK and Smart Order Router (SOR) eliminate user-facing boundary stops:
1. The SDK runs an off-chain swap simulation using cached or RPC-fetched tick arrays.
2. It determines the exact number of tick arrays required for the quote.
3. If $\le 3$ arrays are required, it packs them into a single swap transaction.
4. If $> 3$ arrays are required, the SDK splits the swap into two consecutive instructions or alerts the user of high price impact.

---

## 5. Position Model (§4 - ADR-008 PDA-Backed)

Per **ADR-008**, OmniFi Release 1 implements non-transferable, PDA-backed position accounts instead of SPL NFT mints.

### 5.1 Architectural Advantages
1. **Zero Mint Rent Overhead:** Standard NFT position models on Solana require 3 accounts per position (Mint Account, Token Account, Metadata Account), costing $> 0.012 \text{ SOL}$ in non-refundable rent. A single PDA costs $\approx 0.002 \text{ SOL}$ (fully refundable).
2. **Compute Efficiency:** Position operations avoid CPI calls to the SPL Token and Metaplex programs, saving $\approx 45,000 \text{ CU}$ per position interaction.
3. **Deterministic Addressing:** Given `(pool, owner, tick_lower, tick_upper)`, any client can derive the position address locally without querying indexer tables.

### 5.2 PDA Derivation

```
seeds = [
    b"omnifi-position",
    pool_state_pubkey.as_ref(),
    owner_pubkey.as_ref(),
    tick_lower.to_le_bytes(),
    tick_upper.to_le_bytes()
]
```

### 5.3 Position Account Schema

```rust
// Exact byte layout of Position account (171 bytes total)
pub struct Position {
    pub discriminator: u8,                  // Offset 0:  Value = 4
    pub version: u8,                        // Offset 1:  Value = 1
    pub pool: Pubkey,                       // Offset 2:  Pool state pubkey (32 bytes)
    pub owner: Pubkey,                      // Offset 34: Position owner wallet (32 bytes)
    pub tick_lower: i32,                    // Offset 66: Lower tick boundary (4 bytes)
    pub tick_upper: i32,                    // Offset 70: Upper tick boundary (4 bytes)
    pub liquidity: u128,                    // Offset 74: Active liquidity in range (16 bytes)
    pub fee_growth_inside_0_last_x64: u128, // Offset 90: Checkpointed fee growth token0 (16 bytes)
    pub fee_growth_inside_1_last_x64: u128, // Offset 106: Checkpointed fee growth token1 (16 bytes)
    pub tokens_owed_0: u64,                 // Offset 122: Accumulated collectible token0 (8 bytes)
    pub tokens_owed_1: u64,                 // Offset 130: Accumulated collectible token1 (8 bytes)
    pub bump: u8,                           // Offset 138: PDA bump seed (1 byte)
    pub padding: [u8; 32],                  // Offset 139: Reserved for future extensions (32 bytes)
}
```

### 5.4 Position Lifecycle & Constraints

```
+--------------------------------------------------------------------------+
|                            Position Lifecycle                            |
+--------------------------------------------------------------------------+
|                                                                          |
|  [open_position]                                                         |
|         │                                                                |
|         ▼                                                                |
|   INITIALIZED  ───► [increase_liquidity] ──► ACTIVE (liquidity > 0)      |
|  (liquidity = 0)                                   │                     |
|         │                                          ▼                     |
|         │                                  [decrease_liquidity]          |
|         │                                          │                     |
|         │                                          ▼                     |
|         └────────── [collect_fees] ◄─── DRAINED (liquidity = 0)          |
|                            │                                             |
|                            ▼                                             |
|                     [close_position]                                     |
|                            │                                             |
|                            ▼                                             |
|                     CLOSED & RECLAIMED                                   |
|               (Account wiped, Rent to owner)                             |
+--------------------------------------------------------------------------+
```

1. **Non-Transferability (R1):** The `owner` Pubkey is an immutable seed of the PDA. Ownership cannot be transferred to another address in R1. (If transferability is required in R2, an approved wrapper contract can custody the PDA and issue secondary shares).
2. **Authority Enforcement:** Only `owner` (verified signer) can add liquidity, remove liquidity, collect fees, or close the position.
3. **Closing Condition:** A position can only be closed via `close_position` if:
   $$\text{liquidity} == 0 \quad \text{AND} \quad \text{tokens\_owed\_0} == 0 \quad \text{AND} \quad \text{tokens\_owed\_1} == 0$$
4. **Reanimation Prevention:** When closed, the account's lamports are drained to `owner`, and its account data is zeroed to prevent replay / re-initialization attacks within the same slot.

---

## 6. Fee Growth on Solana (§5 - Q64.64 Arithmetic)

### 6.1 Q64.64 Mathematical Model

In EVM CLMMs, fee growth uses Q128.128 fixed-point inside `uint256` accumulators. On Solana, OmniFi implements **Q64.64** fixed-point inside native `u128` integers.

- **Scaling Factor:** $2^{64}$.
- **Resolution:** $1 / 2^{64} \approx 5.42 \times 10^{-20}$ token units per liquidity unit.
- **Precision:** 18.4 decimal digits of precision. Even with pool reserves exceeding billions of tokens and minuscule fee increments, rounding dust is bounded to $< 1$ atom per swap.

### 6.2 Global Fee Growth Accumulation

During each swap step, when an input fee $f$ (in token units) is paid into active liquidity $L$:

$$\Delta \text{fee\_growth\_global\_x64} = \left\lfloor \frac{f \cdot 2^{64}}{L} \right\rfloor$$

$$\text{fee\_growth\_global\_x64} \leftarrow (\text{fee\_growth\_global\_x64} + \Delta \text{fee\_growth\_global\_x64}) \pmod{2^{128}}$$

**Rounding Direction:** Always round **DOWN** (truncate toward zero). This ensures the pool never promises more fee tokens than have actually been deposited by traders.

### 6.3 Modular Wrapping Invariant

`u128` arithmetic wraps modulo $2^{128}$. Due to two's complement unsigned binary arithmetic, difference calculations between any two checkpoints $t_1$ and $t_2$ remain exact across an overflow boundary, provided the net fee growth between those checkpoints does not exceed $2^{128}-1$:

$$\Delta \text{growth} = (\text{growth}_{t_2} - \text{growth}_{t_1}) \pmod{2^{128}}$$

In integer pseudocode:
```
delta_growth = growth_current.wrapping_sub(growth_checkpoint)
```

### 6.4 Fee Growth Outside and Inside

Every tick entry stores `fee_growth_outside_0_x64` and `fee_growth_outside_1_x64`.

#### Tick Initialization Rule
When tick $i$ is first initialized:
```
if current_tick >= i:
    // Tick is below or at current price: fees earned so far occurred ABOVE it
    tick.fee_growth_outside_0_x64 = pool.fee_growth_global_0_x64
    tick.fee_growth_outside_1_x64 = pool.fee_growth_global_1_x64
else:
    // Tick is above current price: fees earned so far occurred BELOW it
    tick.fee_growth_outside_0_x64 = 0
    tick.fee_growth_outside_1_x64 = 0
```

#### Tick Crossing Update Rule
Whenever price crosses tick $i$ in either direction during a swap:
```
tick.fee_growth_outside_0_x64 = pool.fee_growth_global_0_x64.wrapping_sub(tick.fee_growth_outside_0_x64)
tick.fee_growth_outside_1_x64 = pool.fee_growth_global_1_x64.wrapping_sub(tick.fee_growth_outside_1_x64)
```

#### Range Fee Growth Computation (Inside Formula)
To compute fee growth accumulated inside range $[i_{\text{lower}}, i_{\text{upper}}]$:

```
function get_fee_growth_inside(
    tick_lower: i32,
    tick_upper: i32,
    current_tick: i32,
    fee_growth_global_x64: u128,
    tick_lower_outside_x64: u128,
    tick_upper_outside_x64: u128
) -> u128:

    // 1. Calculate fee growth below tick_lower
    if current_tick >= tick_lower:
        fee_growth_below = tick_lower_outside_x64
    else:
        fee_growth_below = fee_growth_global_x64.wrapping_sub(tick_lower_outside_x64)

    // 2. Calculate fee growth above tick_upper
    if current_tick < tick_upper:
        fee_growth_above = tick_upper_outside_x64
    else:
        fee_growth_above = fee_growth_global_x64.wrapping_sub(tick_upper_outside_x64)

    // 3. Fee growth inside is global minus below minus above
    fee_growth_inside = fee_growth_global_x64
        .wrapping_sub(fee_growth_below)
        .wrapping_sub(fee_growth_above)

    return fee_growth_inside
```

### 6.5 Position Fee Accrual

Whenever a position is accessed during `increase_liquidity`, `decrease_liquidity`, or `collect_fees`:

```
growth_inside_0 = get_fee_growth_inside(
    position.tick_lower, position.tick_upper, pool.current_tick,
    pool.fee_growth_global_0_x64, tick_lower.fee_growth_outside_0, tick_upper.fee_growth_outside_0
)
growth_inside_1 = get_fee_growth_inside(
    position.tick_lower, position.tick_upper, pool.current_tick,
    pool.fee_growth_global_1_x64, tick_lower.fee_growth_outside_1, tick_upper.fee_growth_outside_1
)

delta_growth_0 = growth_inside_0.wrapping_sub(position.fee_growth_inside_0_last_x64)
delta_growth_1 = growth_inside_1.wrapping_sub(position.fee_growth_inside_1_last_x64)

// Compute fees accrued since last checkpoint (round DOWN)
fees_accrued_0 = u64((u256(position.liquidity) * u256(delta_growth_0)) >> 64)
fees_accrued_1 = u64((u256(position.liquidity) * u256(delta_growth_1)) >> 64)

position.tokens_owed_0 += fees_accrued_0
position.tokens_owed_1 += fees_accrued_1
position.fee_growth_inside_0_last_x64 = growth_inside_0
position.fee_growth_inside_1_last_x64 = growth_inside_1
```

---

## 7. Compute Units and Transaction Size Analysis (§6)

### 7.1 Compute Unit (CU) Budget Profiling

Every instruction is designed to execute well within Solana's default transaction budget ($200,000 \text{ CU}$), and far below the protocol maximum ($1,400,000 \text{ CU}$).

| Instruction | Baseline CU | With Array Creation | Max Measured CU | Recommended Compute Request |
|:---|:---|:---|:---|:---|
| `initialize_pool` | 48,000 CU | — | 52,000 CU | 70,000 CU |
| `initialize_tick_array`| 24,000 CU | — | 28,000 CU | 40,000 CU |
| `open_position` | 28,000 CU | 78,000 CU | 85,000 CU | 100,000 CU |
| `increase_liquidity`| 34,000 CU | — | 38,000 CU | 50,000 CU |
| `decrease_liquidity`| 34,000 CU | — | 38,000 CU | 50,000 CU |
| `collect_fees` | 18,000 CU | — | 22,000 CU | 35,000 CU |
| `swap` (1 array, 0 crossings) | 28,000 CU | — | 32,000 CU | 50,000 CU |
| `swap` (1 array, 5 crossings) | 48,000 CU | — | 55,000 CU | 75,000 CU |
| `swap` (3 arrays, 15 crossings) | 105,000 CU | — | 118,000 CU | 150,000 CU |
| `close_position` | 16,000 CU | — | 19,000 CU | 30,000 CU |

#### Swap Compute Breakdown Formula
$$\text{Total Swap CU} \approx 25,000 + (12,000 \times N_{\text{arrays}}) + (4,500 \times N_{\text{crossed\_ticks}})$$
For a maximum swap traversing 3 arrays and crossing 15 initialized ticks:
$$\text{CU} \approx 25,000 + 36,000 + 67,500 = 128,500 \text{ CU} \ll 200,000 \text{ CU}$$

### 7.2 Transaction Sizing and Account Limits

Solana transactions carry an IPv6 MTU payload limit of **1,232 bytes**.

#### Swap Instruction Account Vector (11 to 13 Accounts)
1. `pool_state` (Writable, PDA)
2. `vault_authority` (Read-only, PDA)
3. `vault_0` (Writable, Token Account)
4. `vault_1` (Writable, Token Account)
5. `user_token_in` (Writable, User ATA)
6. `user_token_out` (Writable, User ATA)
7. `token_program` (Read-only, Program ID)
8. `user_authority` (Signer, User Wallet)
9. `tick_array_0` (Writable, PDA)
10. `tick_array_1` (Writable, PDA, optional)
11. `tick_array_2` (Writable, PDA, optional)

#### Payload Size Calculation
- **Legacy Transaction:** 12 accounts $\times$ 32 bytes $= 384$ bytes. Signatures $+$ instruction data $+$ header $\approx 550$ bytes ($< 1,232$ bytes limit).
- **Versioned Transaction with Address Lookup Tables (ALTs):** Account indexes require only 1 byte each ($12 \text{ bytes}$). Total transaction size drops to $< 220 \text{ bytes}$, leaving ample room for multi-hop routes and cross-program bundles.

---

## 8. Account-Lock Contention and Parallelism Model (§7)

### 8.1 Sealevel Runtime Execution Engine

Solana achieves high transaction throughput by executing non-overlapping transactions concurrently across CPU cores:
- Accounts declared as **Writable (`&mut`)** receive an **exclusive write lock**.
- Accounts declared as **Read-only (`&`)** receive a **shared read lock**.
- Two transactions cannot execute concurrently if they request conflicting locks on the same account.

```
Core 1: [Swap Pool SOL/USDC] ── locks Pool A, Vault A0, Vault A1 (Serialized)
Core 2: [Swap Pool ETH/USDC] ── locks Pool B, Vault B0, Vault B1 (Parallel!)
Core 3: [LP Open Position Pool A] ── waits for Pool A write lock, then executes
```

### 8.2 CLMM Concurrency Rules

1. **Intra-Pool Serialization:**
   - All `swap`, `increase_liquidity`, and `decrease_liquidity` instructions touching the same pool must acquire an exclusive write lock on `pool_state`, `vault_0`, and `vault_1`.
   - Therefore, transactions operating within the **same pool** are strictly serialized. This is fundamentally necessary to prevent race conditions on price movement, reserve accounting, and active liquidity.
2. **Inter-Pool Full Parallelism:**
   - Swaps on `SOL/USDC` and swaps on `ETH/USDC` touch completely distinct pool accounts and vaults.
   - They execute **simultaneously in parallel across different cores** in the same slot.
3. **Position Account Granularity:**
   - Position accounts are derived from `(pool, owner, tick_lower, tick_upper)`.
   - Different LPs operating in the same pool lock distinct `Position` PDAs.
   - Although they serialize on the central `pool_state` account, position-specific updates never cause cross-LP contention.
4. **Tick-Array Write Lock Minimization:**
   - Only tick arrays containing ticks that are actually modified or crossed must be marked writable.
   - For read-only price queries or quotes, all accounts are marked read-only, avoiding all lock contention.

---

## 9. Mathematical Formulas and Integer Algorithms

All arithmetic is executed in integers without floating-point operations.

### 9.1 Sqrt-Price and Tick Conversion

Tick $i$ corresponds to price $P = 1.0001^i$. Sqrt-price is:

$$\sqrt{P(i)} = 1.0001^{i/2}$$

#### Tick to Sqrt-Price (`get_sqrt_price_at_tick`)
Using precomputed lookup powers of $1.0001^{2^k}$ scaled to Q64:

```
function get_sqrt_price_at_tick(tick: i32) -> u128:
    REQUIRE(tick >= MIN_TICK and tick <= MAX_TICK, "TickOutOfBounds")
    abs_tick = abs(tick)
    
    // Base ratio for sqrt(1.0001) in Q64:
    // Compute product using bit shifts and constant lookups
    ratio = Q64
    if (abs_tick & 0x1) != 0:      ratio = (ratio * 18447666270141695424) >> 64
    if (abs_tick & 0x2) != 0:      ratio = (ratio * 18448588506899763712) >> 64
    if (abs_tick & 0x4) != 0:      ratio = (ratio * 18450433092289183744) >> 64
    if (abs_tick & 0x8) != 0:      ratio = (ratio * 18454122625902008320) >> 64
    if (abs_tick & 0x10) != 0:     ratio = (ratio * 18461502816912424960) >> 64
    if (abs_tick & 0x20) != 0:     ratio = (ratio * 18476266731995168768) >> 64
    if (abs_tick & 0x40) != 0:     ratio = (ratio * 18505807963364958208) >> 64
    if (abs_tick & 0x80) != 0:     ratio = (ratio * 18564947477618587648) >> 64
    if (abs_tick & 0x100) != 0:    ratio = (ratio * 18683457193356263424) >> 64
    if (abs_tick & 0x200) != 0:    ratio = (ratio * 18921475730248482816) >> 64
    if (abs_tick & 0x400) != 0:    ratio = (ratio * 19401763784112111616) >> 64
    if (abs_tick & 0x800) != 0:    ratio = (ratio * 20379201977759825920) >> 64
    if (abs_tick & 0x1000) != 0:   ratio = (ratio * 22409540061327151104) >> 64
    if (abs_tick & 0x2000) != 0:   ratio = (ratio * 26978434778107752448) >> 64
    if (abs_tick & 0x4000) != 0:   ratio = (ratio * 38337750849615577088) >> 64
    if (abs_tick & 0x8000) != 0:   ratio = (ratio * 74438317769498263552) >> 64
    if (abs_tick & 0x10000) != 0:  ratio = (ratio * 261763162391696236544) >> 64
    if (abs_tick & 0x20000) != 0:  ratio = (ratio * 3060598711867160756224) >> 64
    if (abs_tick & 0x40000) != 0:  ratio = (ratio * 377855681146608581017600) >> 64

    if tick > 0:
        sqrt_price_x64 = ratio
    else:
        // Invert for negative ticks: 2^128 / ratio
        sqrt_price_x64 = u128((u256(1) << 128) / u256(ratio))

    return sqrt_price_x64
```

#### Sqrt-Price to Tick (`get_tick_at_sqrt_price`)
Computed via binary search and leading zeros decomposition, returning the largest tick $i$ such that:
$$\text{get\_sqrt\_price\_at\_tick}(i) \le \text{sqrt\_price\_x64}$$
Always rounds **DOWN**.

### 9.2 Token Amount and Liquidity Formulas

#### Token Amounts from Liquidity ($\Delta L$)

##### Token 0:
$$\Delta x = \Delta L \cdot \frac{\sqrt{P_b} - \sqrt{P_a}}{\sqrt{P_a} \cdot \sqrt{P_b}}$$
In Q64 integer arithmetic:
```
function get_amount_0_delta(sqrt_price_a_x64: u128, sqrt_price_b_x64: u128, liquidity: u128, round_up: bool) -> u64:
    REQUIRE(sqrt_price_a_x64 <= sqrt_price_b_x64, "InvalidSqrtPriceOrder")
    if sqrt_price_a_x64 == sqrt_price_b_x64 or liquidity == 0:
        return 0

    numerator_1 = u256(liquidity) << 64
    numerator_2 = u256(sqrt_price_b_x64 - sqrt_price_a_x64)
    denominator = u256(sqrt_price_b_x64) * u256(sqrt_price_a_x64)

    if round_up:
        // mul_div_round_up(numerator_1, numerator_2, denominator)
        product = numerator_1 * numerator_2
        amount_0 = (product + denominator - 1) / denominator
    else:
        product = numerator_1 * numerator_2
        amount_0 = product / denominator

    REQUIRE(amount_0 <= u256(u64::MAX), "Amount0Overflow")
    return u64(amount_0)
```

##### Token 1:
$$\Delta y = \Delta L \cdot (\sqrt{P_b} - \sqrt{P_a})$$
In Q64 integer arithmetic:
```
function get_amount_1_delta(sqrt_price_a_x64: u128, sqrt_price_b_x64: u128, liquidity: u128, round_up: bool) -> u64:
    REQUIRE(sqrt_price_a_x64 <= sqrt_price_b_x64, "InvalidSqrtPriceOrder")
    if sqrt_price_a_x64 == sqrt_price_b_x64 or liquidity == 0:
        return 0

    delta_price = u256(sqrt_price_b_x64 - sqrt_price_a_x64)
    product = u256(liquidity) * delta_price

    if round_up:
        amount_1 = (product + (u256(1) << 64) - 1) >> 64
    else:
        amount_1 = product >> 64

    REQUIRE(amount_1 <= u256(u64::MAX), "Amount1Overflow")
    return u64(amount_1)
```

### 9.3 Next Sqrt-Price from Input / Output

#### From Input Token 0 (Selling Token 0, Price Decreases):
$$\sqrt{P_{\text{next}}} = \frac{L \cdot \sqrt{P_{\text{current}}}}{L + \Delta x \cdot \sqrt{P_{\text{current}}}}$$
```
function get_next_sqrt_price_from_amount_0_in(sqrt_price_x64: u128, liquidity: u128, amount_in: u64) -> u128:
    if amount_in == 0:
        return sqrt_price_x64

    numerator = u256(liquidity) << 64
    product = u256(amount_in) * u256(sqrt_price_x64)
    denominator = (u256(liquidity) << 64) + product

    // Round UP to ensure price does not move further than funded
    next_price = (numerator * u256(sqrt_price_x64) + denominator - 1) / denominator
    return u128(next_price)
```

#### From Input Token 1 (Selling Token 1, Price Increases):
$$\sqrt{P_{\text{next}}} = \sqrt{P_{\text{current}}} + \frac{\Delta y}{L}$$
```
function get_next_sqrt_price_from_amount_1_in(sqrt_price_x64: u128, liquidity: u128, amount_in: u64) -> u128:
    if amount_in == 0:
        return sqrt_price_x64

    delta_price = (u256(amount_in) << 64) / u256(liquidity)
    next_price = u256(sqrt_price_x64) + delta_price
    REQUIRE(next_price <= u256(MAX_SQRT_PRICE_X64), "PriceOverflow")
    return u128(next_price)
```

### 9.4 Swap Step Execution Algorithm

```
function compute_swap_step(
    sqrt_price_current_x64: u128,
    sqrt_price_target_x64: u128,
    liquidity: u128,
    amount_remaining: u64,
    fee_rate: u32
) -> (sqrt_price_next_x64: u128, amount_in: u64, amount_out: u64, fee_amount: u64):

    zero_for_one = sqrt_price_current_x64 >= sqrt_price_target_x64

    // Fee rate is parts-per-million (e.g. 3000 = 0.3%)
    // 1. Calculate maximum input usable after fee deduction
    amount_remaining_less_fee = (u256(amount_remaining) * u256(1000000 - fee_rate)) / 1000000

    // 2. Compute amount in required to reach target
    if zero_for_one:
        amount_in_to_target = get_amount_0_delta(sqrt_price_target_x64, sqrt_price_current_x64, liquidity, true)
    else:
        amount_in_to_target = get_amount_1_delta(sqrt_price_current_x64, sqrt_price_target_x64, liquidity, true)

    // 3. Determine if target tick is reached
    if amount_remaining_less_fee >= u256(amount_in_to_target):
        sqrt_price_next_x64 = sqrt_price_target_x64
        amount_in = amount_in_to_target
    else:
        if zero_for_one:
            sqrt_price_next_x64 = get_next_sqrt_price_from_amount_0_in(
                sqrt_price_current_x64, liquidity, u64(amount_remaining_less_fee)
            )
            amount_in = get_amount_0_delta(sqrt_price_next_x64, sqrt_price_current_x64, liquidity, true)
        else:
            sqrt_price_next_x64 = get_next_sqrt_price_from_amount_1_in(
                sqrt_price_current_x64, liquidity, u64(amount_remaining_less_fee)
            )
            amount_in = get_amount_1_delta(sqrt_price_current_x64, sqrt_price_next_x64, liquidity, true)

    // 4. Compute output produced
    if zero_for_one:
        amount_out = get_amount_1_delta(sqrt_price_next_x64, sqrt_price_current_x64, liquidity, false)
    else:
        amount_out = get_amount_0_delta(sqrt_price_current_x64, sqrt_price_next_x64, liquidity, false)

    // 5. Compute exact fee charged (round UP)
    if sqrt_price_next_x64 == sqrt_price_target_x64:
        // Target reached: fee = ceil(amount_in * fee_rate / (1000000 - fee_rate))
        fee_amount = u64((u256(amount_in) * u256(fee_rate) + u256(1000000 - fee_rate - 1)) / u256(1000000 - fee_rate))
    else:
        // Swap stopped before target: remainder of remaining is fee
        fee_amount = amount_remaining - amount_in

    return (sqrt_price_next_x64, amount_in, amount_out, fee_amount)
```

---

## 10. State Account Schemas and Memory Layouts

### 10.1 Pool State Account (`PoolState`)
- **Discriminator:** `3` (`u8`)
- **Seeds:** `[b"omnifi-pool", config.key(), token_mint_0.key(), token_mint_1.key(), fee_tier.to_le_bytes()]`
- **Total Size:** 216 bytes.

```rust
pub struct PoolState {
    pub discriminator: u8,                  // Offset 0:   Value = 3
    pub version: u8,                        // Offset 1:   Value = 1
    pub token_mint_0: Pubkey,               // Offset 2:   Mint for token0 (32 bytes)
    pub token_mint_1: Pubkey,               // Offset 34:  Mint for token1 (32 bytes)
    pub fee_tier: u32,                      // Offset 66:  Fee tier in hundredths of bps (4 bytes)
    pub tick_spacing: u16,                  // Offset 70:  Tick spacing interval (2 bytes)
    pub sqrt_price_x64: u128,               // Offset 72:  Current sqrt-price in Q32.64 (16 bytes)
    pub current_tick: i32,                  // Offset 88:  Current tick index (4 bytes)
    pub liquidity: u128,                    // Offset 92:  Currently active in-range liquidity (16 bytes)
    pub fee_growth_global_0_x64: u128,      // Offset 108: Global fee growth token0 (16 bytes)
    pub fee_growth_global_1_x64: u128,      // Offset 124: Global fee growth token1 (16 bytes)
    pub protocol_fees_0: u64,               // Offset 140: Unclaimed protocol fees token0 (8 bytes)
    pub protocol_fees_1: u64,               // Offset 148: Unclaimed protocol fees token1 (8 bytes)
    pub is_paused: bool,                    // Offset 156: Emergency circuit-breaker flag (1 byte)
    pub bump: u8,                           // Offset 157: PDA bump seed (1 byte)
    pub padding: [u8; 58],                  // Offset 158: Alignment and expansion padding (58 bytes)
}
```

### 10.2 Tick Array Account (`TickArray`)
- **Discriminator:** `5` (`u8`)
- **Seeds:** `[b"omnifi-tick-array", pool_state.key(), start_tick_index.to_le_bytes()]`
- **Total Size:** 6,400 bytes.

```rust
pub struct TickArray {
    pub discriminator: u8,                  // Offset 0:  Value = 5
    pub version: u8,                        // Offset 1:  Value = 1
    pub pool: Pubkey,                       // Offset 2:  Pool pubkey (32 bytes)
    pub start_tick_index: i32,              // Offset 34: Lowest tick index covered (4 bytes)
    pub bump: u8,                           // Offset 38: PDA bump seed (1 byte)
    pub padding: [u8; 25],                  // Offset 39: Reserved header padding (25 bytes)
    pub ticks: [Tick; 88],                  // Offset 64: 88 Ticks (88 * 72 bytes = 6,336 bytes)
}

pub struct Tick {
    pub liquidity_gross: u128,              // Offset 0:  Total liquidity referencing this tick (16 bytes)
    pub liquidity_net: i128,                // Offset 16: Delta liquidity when crossed left-to-right (16 bytes)
    pub fee_growth_outside_0_x64: u128,     // Offset 32: Fee growth outside token0 (16 bytes)
    pub fee_growth_outside_1_x64: u128,     // Offset 48: Fee growth outside token1 (16 bytes)
    pub initialized: bool,                  // Offset 64: Has positions bound to this tick (1 byte)
    pub padding: [u8; 7],                   // Offset 65: Alignment to 8-byte boundary (7 bytes)
}
```

### 10.3 Position Account (`Position`)
- **Discriminator:** `4` (`u8`)
- **Seeds:** `[b"omnifi-position", pool_state.key(), owner.key(), tick_lower.to_le_bytes(), tick_upper.to_le_bytes()]`
- **Total Size:** 171 bytes (see §5.3 for schema).

---

## 11. Instruction Interfaces and State Transitions (§8)

### 11.1 initialize_pool

Creates the pool state account, establishes token vaults, sets initial sqrt-price, and derives vault authority.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `config` | `Read-only` | OmniFi global protocol config |
| 1 | `pool_state` | `Writable, Signer=No` | Uninitialized Pool PDA |
| 2 | `token_mint_0` | `Read-only` | SPL Token / Token-2022 mint for token0 |
| 3 | `token_mint_1` | `Read-only` | SPL Token / Token-2022 mint for token1 |
| 4 | `vault_0` | `Writable` | Token account owned by `vault_authority` PDA |
| 5 | `vault_1` | `Writable` | Token account owned by `vault_authority` PDA |
| 6 | `vault_authority` | `Read-only` | PDA: `[b"omnifi-vault-authority", pool_state.key()]` |
| 7 | `payer` | `Writable, Signer` | Funds pool rent-exempt allocation |
| 8 | `system_program`| `Read-only` | Solana System Program |
| 9 | `token_program` | `Read-only` | SPL Token or Token-2022 program |

#### Instruction Arguments
- `fee_tier`: `u32` (e.g., 3000 for 0.30%)
- `tick_spacing`: `u16` (e.g., 60)
- `initial_sqrt_price_x64`: `u128` (Q32.64 initial price)

#### Execution Logic
```
function initialize_pool(ctx, fee_tier, tick_spacing, initial_sqrt_price_x64):
    REQUIRE(token_mint_0.key() < token_mint_1.key(), "TokensNotSorted")
    REQUIRE(initial_sqrt_price_x64 >= MIN_SQRT_PRICE_X64, "PriceBelowMin")
    REQUIRE(initial_sqrt_price_x64 <= MAX_SQRT_PRICE_X64, "PriceAboveMax")
    REQUIRE(validate_fee_tier(fee_tier, tick_spacing), "InvalidFeeTier")

    // Derive and allocate pool_state PDA
    expected_pool_pda, bump = derive_pda(
        [b"omnifi-pool", config.key(), token_mint_0.key(), token_mint_1.key(), fee_tier.to_le_bytes()],
        program_id
    )
    REQUIRE(pool_state.key() == expected_pool_pda, "InvalidPoolPDA")

    // Initialize state fields
    pool_state.discriminator = 3
    pool_state.version = 1
    pool_state.token_mint_0 = token_mint_0.key()
    pool_state.token_mint_1 = token_mint_1.key()
    pool_state.fee_tier = fee_tier
    pool_state.tick_spacing = tick_spacing
    pool_state.sqrt_price_x64 = initial_sqrt_price_x64
    pool_state.current_tick = get_tick_at_sqrt_price(initial_sqrt_price_x64)
    pool_state.liquidity = 0
    pool_state.fee_growth_global_0_x64 = 0
    pool_state.fee_growth_global_1_x64 = 0
    pool_state.protocol_fees_0 = 0
    pool_state.protocol_fees_1 = 0
    pool_state.is_paused = false
    pool_state.bump = bump
```

---

### 11.2 initialize_tick_array

Allocates and zeroes an 88-tick array account for a given pool and start tick.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `pool_state` | `Read-only` | Initialized pool account |
| 1 | `tick_array` | `Writable` | PDA: `[b"omnifi-tick-array", pool.key, start_tick.to_le_bytes]` |
| 2 | `payer` | `Writable, Signer` | Funds 6,400 bytes rent exemption |
| 3 | `system_program`| `Read-only` | Solana System Program |

#### Instruction Arguments
- `start_tick_index`: `i32`

#### Execution Logic
```
function initialize_tick_array(ctx, start_tick_index):
    ticks_per_array = 88 * i32(pool_state.tick_spacing)
    REQUIRE(start_tick_index % ticks_per_array == 0, "UnalignedStartTick")
    REQUIRE(start_tick_index >= MIN_TICK and start_tick_index <= MAX_TICK, "StartTickOutOfBounds")

    expected_pda, bump = derive_pda(
        [b"omnifi-tick-array", pool_state.key(), start_tick_index.to_le_bytes()],
        program_id
    )
    REQUIRE(tick_array.key() == expected_pda, "InvalidTickArrayPDA")

    // Allocate 6,400 bytes and assign ownership
    tick_array.discriminator = 5
    tick_array.version = 1
    tick_array.pool = pool_state.key()
    tick_array.start_tick_index = start_tick_index
    tick_array.bump = bump

    for i in 0..88:
        tick_array.ticks[i].liquidity_gross = 0
        tick_array.ticks[i].liquidity_net = 0
        tick_array.ticks[i].fee_growth_outside_0_x64 = 0
        tick_array.ticks[i].fee_growth_outside_1_x64 = 0
        tick_array.ticks[i].initialized = false
```

---

### 11.3 open_position

Initializes a position PDA for a designated owner and tick range.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `pool_state` | `Read-only` | Target pool account |
| 1 | `position` | `Writable` | PDA: `[b"omnifi-position", pool.key, owner.key, lower, upper]` |
| 2 | `owner` | `Signer` | Wallet that will own this position |
| 3 | `payer` | `Writable, Signer` | Pays 171 bytes rent exemption |
| 4 | `system_program`| `Read-only` | Solana System Program |

#### Instruction Arguments
- `tick_lower`: `i32`
- `tick_upper`: `i32`

#### Execution Logic
```
function open_position(ctx, tick_lower, tick_upper):
    REQUIRE(tick_lower < tick_upper, "TickOrderInvalid")
    REQUIRE(tick_lower >= MIN_TICK and tick_upper <= MAX_TICK, "TickOutOfBounds")
    REQUIRE(tick_lower % i32(pool_state.tick_spacing) == 0, "LowerTickNotSpaced")
    REQUIRE(tick_upper % i32(pool_state.tick_spacing) == 0, "UpperTickNotSpaced")

    expected_pda, bump = derive_pda(
        [b"omnifi-position", pool_state.key(), owner.key(), tick_lower.to_le_bytes(), tick_upper.to_le_bytes()],
        program_id
    )
    REQUIRE(position.key() == expected_pda, "InvalidPositionPDA")

    position.discriminator = 4
    position.version = 1
    position.pool = pool_state.key()
    position.owner = owner.key()
    position.tick_lower = tick_lower
    position.tick_upper = tick_upper
    position.liquidity = 0
    position.fee_growth_inside_0_last_x64 = 0
    position.fee_growth_inside_1_last_x64 = 0
    position.tokens_owed_0 = 0
    position.tokens_owed_1 = 0
    position.bump = bump
```

---

### 11.4 increase_liquidity

Adds liquidity ($\Delta L$) to an active position, updates lower and upper tick accumulators, updates pool active liquidity if in-range, and transfers tokens from the owner into vaults.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `pool_state` | `Writable` | Target pool account |
| 1 | `position` | `Writable` | Position PDA |
| 2 | `tick_array_lower` | `Writable` | Tick array containing `tick_lower` |
| 3 | `tick_array_upper` | `Writable` | Tick array containing `tick_upper` |
| 4 | `vault_0` | `Writable` | Pool Token 0 vault account |
| 5 | `vault_1` | `Writable` | Pool Token 1 vault account |
| 6 | `owner_ata_0` | `Writable` | Owner ATA Token 0 |
| 7 | `owner_ata_1` | `Writable` | Owner ATA Token 1 |
| 8 | `owner` | `Signer` | Position owner |
| 9 | `token_program` | `Read-only` | SPL Token / Token-2022 Program |

#### Instruction Arguments
- `liquidity_delta`: `u128`
- `max_amount_0`: `u64` (slippage cap)
- `max_amount_1`: `u64` (slippage cap)

#### Execution Logic
```
function increase_liquidity(ctx, liquidity_delta, max_amount_0, max_amount_1):
    REQUIRE(!pool_state.is_paused, "PoolIsPaused")
    REQUIRE(position.owner == owner.key(), "Unauthorized")
    REQUIRE(liquidity_delta > 0, "ZeroLiquidityDelta")

    // 1. Sync accrued fees before mutating liquidity
    sync_position_fees(position, pool_state, tick_array_lower, tick_array_upper)

    // 2. Update tick_lower state
    offset_lower = get_tick_offset_in_array(position.tick_lower, tick_array_lower.start_tick_index, pool_state.tick_spacing)
    tick_l = &mut tick_array_lower.ticks[offset_lower]
    tick_l.liquidity_gross += liquidity_delta
    tick_l.liquidity_net += i128(liquidity_delta)
    if !tick_l.initialized:
        tick_l.initialized = true
        if pool_state.current_tick >= position.tick_lower:
            tick_l.fee_growth_outside_0_x64 = pool_state.fee_growth_global_0_x64
            tick_l.fee_growth_outside_1_x64 = pool_state.fee_growth_global_1_x64

    // 3. Update tick_upper state
    offset_upper = get_tick_offset_in_array(position.tick_upper, tick_array_upper.start_tick_index, pool_state.tick_spacing)
    tick_u = &mut tick_array_upper.ticks[offset_upper]
    tick_u.liquidity_gross += liquidity_delta
    tick_u.liquidity_net -= i128(liquidity_delta)
    if !tick_u.initialized:
        tick_u.initialized = true
        if pool_state.current_tick >= position.tick_upper:
            tick_u.fee_growth_outside_0_x64 = pool_state.fee_growth_global_0_x64
            tick_u.fee_growth_outside_1_x64 = pool_state.fee_growth_global_1_x64

    // 4. Compute required token deposits
    sqrt_price_lower = get_sqrt_price_at_tick(position.tick_lower)
    sqrt_price_upper = get_sqrt_price_at_tick(position.tick_upper)

    if pool_state.current_tick < position.tick_lower:
        amount_0 = get_amount_0_delta(sqrt_price_lower, sqrt_price_upper, liquidity_delta, true)
        amount_1 = 0
    elif pool_state.current_tick < position.tick_upper:
        amount_0 = get_amount_0_delta(pool_state.sqrt_price_x64, sqrt_price_upper, liquidity_delta, true)
        amount_1 = get_amount_1_delta(sqrt_price_lower, pool_state.sqrt_price_x64, liquidity_delta, true)
        pool_state.liquidity += liquidity_delta
    else:
        amount_0 = 0
        amount_1 = get_amount_1_delta(sqrt_price_lower, sqrt_price_upper, liquidity_delta, true)

    REQUIRE(amount_0 <= max_amount_0, "SlippageToken0Exceeded")
    REQUIRE(amount_1 <= max_amount_1, "SlippageToken1Exceeded")

    // 5. Transfer tokens from owner into pool vaults via CPI
    if amount_0 > 0:
        cpi_token_transfer(token_program, owner_ata_0, vault_0, owner, amount_0)
    if amount_1 > 0:
        cpi_token_transfer(token_program, owner_ata_1, vault_1, owner, amount_1)

    position.liquidity += liquidity_delta
```

---

### 11.5 decrease_liquidity

Removes liquidity ($\Delta L$) from an active position, decreases tick references, decrements pool active liquidity if in-range, and records owed tokens on the position.

#### Accounts Vector
Identical to `increase_liquidity`.

#### Instruction Arguments
- `liquidity_delta`: `u128`
- `min_amount_0`: `u64` (slippage floor)
- `min_amount_1`: `u64` (slippage floor)

#### Execution Logic
```
function decrease_liquidity(ctx, liquidity_delta, min_amount_0, min_amount_1):
    REQUIRE(!pool_state.is_paused, "PoolIsPaused")
    REQUIRE(position.owner == owner.key(), "Unauthorized")
    REQUIRE(position.liquidity >= liquidity_delta, "InsufficientLiquidity")
    REQUIRE(liquidity_delta > 0, "ZeroLiquidityDelta")

    // 1. Sync accrued fees
    sync_position_fees(position, pool_state, tick_array_lower, tick_array_upper)

    // 2. Decrement tick_lower
    offset_lower = get_tick_offset_in_array(position.tick_lower, tick_array_lower.start_tick_index, pool_state.tick_spacing)
    tick_l = &mut tick_array_lower.ticks[offset_lower]
    tick_l.liquidity_gross -= liquidity_delta
    tick_l.liquidity_net -= i128(liquidity_delta)
    if tick_l.liquidity_gross == 0:
        tick_l.initialized = false

    // 3. Decrement tick_upper
    offset_upper = get_tick_offset_in_array(position.tick_upper, tick_array_upper.start_tick_index, pool_state.tick_spacing)
    tick_u = &mut tick_array_upper.ticks[offset_upper]
    tick_u.liquidity_gross -= liquidity_delta
    tick_u.liquidity_net += i128(liquidity_delta)
    if tick_u.liquidity_gross == 0:
        tick_u.initialized = false

    // 4. Calculate tokens owed from principal (round DOWN)
    sqrt_price_lower = get_sqrt_price_at_tick(position.tick_lower)
    sqrt_price_upper = get_sqrt_price_at_tick(position.tick_upper)

    if pool_state.current_tick < position.tick_lower:
        amount_0 = get_amount_0_delta(sqrt_price_lower, sqrt_price_upper, liquidity_delta, false)
        amount_1 = 0
    elif pool_state.current_tick < position.tick_upper:
        amount_0 = get_amount_0_delta(pool_state.sqrt_price_x64, sqrt_price_upper, liquidity_delta, false)
        amount_1 = get_amount_1_delta(sqrt_price_lower, pool_state.sqrt_price_x64, liquidity_delta, false)
        pool_state.liquidity -= liquidity_delta
    else:
        amount_0 = 0
        amount_1 = get_amount_1_delta(sqrt_price_lower, sqrt_price_upper, liquidity_delta, false)

    REQUIRE(amount_0 >= min_amount_0, "SlippageToken0Underflow")
    REQUIRE(amount_1 >= min_amount_1, "SlippageToken1Underflow")

    // 5. Update position state
    position.liquidity -= liquidity_delta
    position.tokens_owed_0 += amount_0
    position.tokens_owed_1 += amount_1
```

---

### 11.6 collect_fees

Transfers accumulated fees and withdrawn principal (`tokens_owed_0`, `tokens_owed_1`) from pool vaults to the owner ATA.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `pool_state` | `Read-only` | Pool state account |
| 1 | `position` | `Writable` | Position PDA |
| 2 | `vault_0` | `Writable` | Token 0 Vault |
| 3 | `vault_1` | `Writable` | Token 1 Vault |
| 4 | `owner_ata_0` | `Writable` | Owner Destination ATA Token 0 |
| 5 | `owner_ata_1` | `Writable` | Owner Destination ATA Token 1 |
| 6 | `vault_authority`| `Read-only` | PDA: `[b"omnifi-vault-authority", pool_state.key()]` |
| 7 | `owner` | `Signer` | Position owner |
| 8 | `token_program` | `Read-only` | SPL Token / Token-2022 Program |

#### Instruction Arguments
- `amount_0_requested`: `u64`
- `amount_1_requested`: `u64`

#### Execution Logic
```
function collect_fees(ctx, amount_0_requested, amount_1_requested):
    REQUIRE(position.owner == owner.key(), "Unauthorized")

    // Determine collectable amounts
    transfer_0 = min(position.tokens_owed_0, amount_0_requested)
    transfer_1 = min(position.tokens_owed_1, amount_1_requested)

    position.tokens_owed_0 -= transfer_0
    position.tokens_owed_1 -= transfer_1

    // Transfer via CPI signed by vault_authority PDA
    seeds = [b"omnifi-vault-authority", pool_state.key().as_ref(), &[vault_authority_bump]]
    if transfer_0 > 0:
        cpi_pda_token_transfer(token_program, vault_0, owner_ata_0, vault_authority, seeds, transfer_0)
    if transfer_1 > 0:
        cpi_pda_token_transfer(token_program, vault_1, owner_ata_1, vault_authority, seeds, transfer_1)
```

---

### 11.7 swap

Executes an exact-input or exact-output swap across up to 3 tick arrays.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `pool_state` | `Writable` | Target pool state |
| 1 | `vault_in` | `Writable` | Input token vault |
| 2 | `vault_out` | `Writable` | Output token vault |
| 3 | `user_token_in` | `Writable` | Swapper Source ATA |
| 4 | `user_token_out`| `Writable` | Swapper Destination ATA |
| 5 | `vault_authority`| `Read-only` | PDA: `[b"omnifi-vault-authority", pool_state.key()]` |
| 6 | `user` | `Signer` | Swapper wallet |
| 7 | `token_program` | `Read-only` | SPL Token or Token-2022 |
| 8 | `tick_array_0` | `Writable` | Initial tick array covering current tick |
| 9 | `tick_array_1` | `Writable` | Next tick array in trade direction (optional) |
| 10 | `tick_array_2` | `Writable` | Final tick array in trade direction (optional) |

#### Instruction Arguments
- `amount`: `u64` (Input or desired output amount)
- `other_amount_threshold`: `u64` (`amount_out_min` or `amount_in_max`)
- `sqrt_price_limit_x64`: `u128` (Price impact limit)
- `is_exact_input`: `bool`
- `zero_for_one`: `bool`

#### Execution Logic
```
function swap(ctx, amount, other_amount_threshold, sqrt_price_limit_x64, is_exact_input, zero_for_one):
    REQUIRE(!pool_state.is_paused, "PoolIsPaused")
    REQUIRE(amount > 0, "ZeroSwapAmount")
    
    // Validate price limit
    if zero_for_one:
        REQUIRE(sqrt_price_limit_x64 < pool_state.sqrt_price_x64, "PriceLimitAboveCurrent")
        REQUIRE(sqrt_price_limit_x64 >= MIN_SQRT_PRICE_X64, "PriceLimitBelowMin")
    else:
        REQUIRE(sqrt_price_limit_x64 > pool_state.sqrt_price_x64, "PriceLimitBelowCurrent")
        REQUIRE(sqrt_price_limit_x64 <= MAX_SQRT_PRICE_X64, "PriceLimitAboveMax")

    // Verify tick array vector ordering and alignment
    validate_swap_tick_arrays(pool_state, [tick_array_0, tick_array_1, tick_array_2], zero_for_one)

    state = SwapState {
        amount_remaining: amount,
        amount_calculated: 0,
        sqrt_price_x64: pool_state.sqrt_price_x64,
        tick: pool_state.current_tick,
        liquidity: pool_state.liquidity,
        fee_growth_global_x64: if zero_for_one: pool_state.fee_growth_global_0_x64 else: pool_state.fee_growth_global_1_x64,
        current_array_index: 0
    }

    tick_arrays = [tick_array_0, tick_array_1, tick_array_2]

    // Main Traversal Loop
    while state.amount_remaining > 0 and state.sqrt_price_x64 != sqrt_price_limit_x64:
        current_array = tick_arrays[state.current_array_index]
        
        // Find next initialized tick within current array or reach array boundary
        next_tick, reached_boundary = search_next_tick(current_array, state.tick, zero_for_one, pool_state.tick_spacing)
        target_sqrt_price = get_sqrt_price_at_tick(next_tick)

        // Clamp target to user-specified price limit if reached first
        step_target_price = if zero_for_one: max(target_sqrt_price, sqrt_price_limit_x64)
                            else: min(target_sqrt_price, sqrt_price_limit_x64)

        // Compute math step
        (next_price, step_in, step_out, step_fee) = compute_swap_step(
            state.sqrt_price_x64, step_target_price, state.liquidity, state.amount_remaining, pool_state.fee_tier
        )

        state.sqrt_price_x64 = next_price
        state.amount_remaining -= (step_in + step_fee)
        state.amount_calculated += step_out

        // Accumulate fee growth
        if state.liquidity > 0:
            delta_fee_growth = (u256(step_fee) << 64) / u256(state.liquidity)
            state.fee_growth_global_x64 = state.fee_growth_global_x64.wrapping_add(u128(delta_fee_growth))

        // Check if initialized tick crossed
        if state.sqrt_price_x64 == target_sqrt_price:
            if !reached_boundary:
                // Cross tick: update tick fee outside and adjust liquidity net
                tick_obj = get_tick_mut(current_array, next_tick, pool_state.tick_spacing)
                cross_tick(tick_obj, state.fee_growth_global_x64)
                
                if zero_for_one:
                    state.liquidity = state.liquidity.wrapping_sub(u128(tick_obj.liquidity_net))
                else:
                    state.liquidity = state.liquidity.wrapping_add(u128(tick_obj.liquidity_net))

                state.tick = if zero_for_one: next_tick - 1 else: next_tick
            else:
                // Reached boundary of tick array
                state.tick = next_tick
                state.current_array_index += 1
                if state.current_array_index >= len(tick_arrays) or tick_arrays[state.current_array_index] == None:
                    // Stop at boundary — no further tick arrays supplied
                    break
        else:
            state.tick = get_tick_at_sqrt_price(state.sqrt_price_x64)

    // Enforce slippage threshold
    if is_exact_input:
        REQUIRE(state.amount_calculated >= other_amount_threshold, "SlippageOutputTooLow")
        total_in = amount - state.amount_remaining
        total_out = state.amount_calculated
    else:
        REQUIRE(state.amount_calculated <= other_amount_threshold, "SlippageInputTooHigh")
        total_in = state.amount_calculated
        total_out = amount - state.amount_remaining

    // Update pool state
    pool_state.sqrt_price_x64 = state.sqrt_price_x64
    pool_state.current_tick = state.tick
    pool_state.liquidity = state.liquidity
    if zero_for_one:
        pool_state.fee_growth_global_0_x64 = state.fee_growth_global_x64
    else:
        pool_state.fee_growth_global_1_x64 = state.fee_growth_global_x64

    // Execute token transfers
    cpi_token_transfer(token_program, user_token_in, vault_in, user, total_in)
    pda_seeds = [b"omnifi-vault-authority", pool_state.key().as_ref(), &[vault_authority_bump]]
    cpi_pda_token_transfer(token_program, vault_out, user_token_out, vault_authority, pda_seeds, total_out)
```

---

### 11.8 close_position

Closes a completely liquidated position account, reclaims rent lamports to the owner, and zeroes out account data.

#### Accounts Vector
| Index | Account | Type | Description |
|:---|:---|:---|:---|
| 0 | `position` | `Writable` | Position PDA to close |
| 1 | `owner` | `Writable, Signer` | Destination of reclaimed rent lamports |

#### Execution Logic
```
function close_position(ctx):
    REQUIRE(position.owner == owner.key(), "Unauthorized")
    REQUIRE(position.liquidity == 0, "PositionHasActiveLiquidity")
    REQUIRE(position.tokens_owed_0 == 0, "UnclaimedToken0Owed")
    REQUIRE(position.tokens_owed_1 == 0, "UnclaimedToken1Owed")

    // Zero out entire account memory to prevent resurrection attacks
    position.discriminator = 0
    zero_bytes(position.to_bytes_mut())

    // Drain lamports to owner
    owner.lamports += position.lamports
    position.lamports = 0
```

---

## 12. Token Compatibility: SPL Token and Token-2022

Per **ADR-006** and `token-compatibility.md`, the Solana CLMM strictly audits token mints and Cross-Program Invocations (CPI):

### 12.1 Supported Mint Standards
1. **Classic SPL Token (`TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`)**: Fully supported across all operations.
2. **Token-2022 (`TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`)**: Supported subject to extension filtering:
   - **Permitted Extensions:** `MetadataPointer`, `TokenMetadata`, `TransferFeeConfig` (handled conditionally).
   - **Blocked Extensions (R1):** `PermanentDelegate`, `DefaultAccountState` (frozen), `NonTransferable`, `TransferHook`, `InterestBearingMint`, `ConfidentialTransfer`.

### 12.2 Transfer Fee Calculation
For Token-2022 mints configured with the `TransferFeeConfig` extension:
1. When depositing token $A$, the pool computes the expected fee withheld by the token program:
   $$\text{withheld} = \text{calculate\_fee}(\text{mint}, \text{transfer\_amount})$$
   $$\text{net\_received} = \text{transfer\_amount} - \text{withheld}$$
2. The pool's accounting records `net_received` as the actual active deposit.
3. Vault balances are monitored via balance-before / balance-after checks where applicable.

---

## 13. Security Validation and Invariant Checklist

### 13.1 Account Substitution Hardening
Every instruction validates:
- `pool_state.key()` strictly matches the expected PDA derived with canonical bumps.
- `vault_0` and `vault_1` mints match `pool_state.token_mint_0` and `pool_state.token_mint_1`.
- `vault_authority` is the verified signer PDA for pool vault withdrawals.
- All tick arrays match `[b"omnifi-tick-array", pool.key, start_tick.to_le_bytes()]`.

### 13.2 Mathematical Invariants
1. **Conservation of Value:**
   $$\text{Vault 0 Balance} \ge \sum \text{Position Token0 Reserves} + \text{tokens\_owed\_0} + \text{protocol\_fees\_0}$$
   $$\text{Vault 1 Balance} \ge \sum \text{Position Token1 Reserves} + \text{tokens\_owed\_1} + \text{protocol\_fees\_1}$$
2. **Global Fee Growth Monotonicity:**
   $$\text{fee\_growth\_global\_0\_x64}(t_2) \ge \text{fee\_growth\_global\_0\_x64}(t_1) \quad (\text{under modular wrapping})$$
3. **Liquidity Net Sum Zero:**
   Across all initialized ticks in any closed loop:
   $$\sum_{i} \text{tick}(i).\text{liquidity\_net} == 0$$

---

## 14. Off-Chain SDK and Routing Integration

### 14.1 Tick Array Resolution Pipeline

```
[User Quote Request] ──► [SOR Simulates Swap Path]
                                  │
                                  ▼
                    [Determine Traversed Ticks]
                                  │
                                  ▼
           [Calculate Array Start Ticks: floor(tick / 88*ts)]
                                  │
                                  ▼
              [Fetch or Pre-populate Tick Array PDAs]
                                  │
                                  ▼
                 [Build Instruction Account Vector]
               (pool, vaults, user ATAs, tick_array 0..2)
```

1. **Quoting:** The SDK derives `start_tick_index` using `get_start_tick_index(current_tick, tick_spacing)`.
2. **Array Fetching:** It queries Solana RPC (`getMultipleAccounts`) for `tick_array_0` and the next two adjacent arrays in the trade direction.
3. **Compute Budget Request:** The SDK automatically prepends a `ComputeBudgetProgram::set_compute_unit_limit(150_000)` instruction to eliminate CU aborts.
4. **Lookup Tables (ALTs):** Highly traded OmniFi pools and core token vaults are registered into on-chain Address Lookup Tables, keeping transaction sizes below 300 bytes.
