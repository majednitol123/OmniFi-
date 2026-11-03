# OmniFi — EVM v4-Inspired Singleton Architecture Specification

**Version:** 1.0  
**Status:** Phase 6 Deliverable (Specification + Foundation Scaffold per ADR-004)  
**Date:** 2026-11-01  
**Scope:** Architecture specification for EVM Singleton Pool Manager, Flash Accounting, and Transient Delta Accounting  
**Target EVM:** Cancun (`solc 0.8.26` with EIP-1153 `TSTORE` / `TLOAD`)  
**Related ADRs:** [ADR-004 (v4 Singleton Scope)](../adr/ADR-004-v4-singleton-scope.md), [ADR-007 (Economic Parameters)](../adr/ADR-007-economic-parameters.md), [ADR-010 (Upgradeability)](../adr/ADR-010-upgradeability.md), [ADR-015 (Token Authorization)](../adr/ADR-015-token-authorization.md)  
**Normative References:** [EVM CLMM Specification](evm-clmm-spec.md), [Fee and Rounding Specification](fee-and-rounding-spec.md)

---

## 1. Architectural Overview

### 1.1 Singleton Paradigm vs Isolated Pools

In traditional AMMs (such as OmniFi V2 and OmniFi CLMM Release 1), each trading pair or fee tier is deployed as a distinct smart contract instance holding its own token balances. While this guarantees isolated failure domains, multi-hop swaps require physical token transfers between consecutive pair contracts (e.g., Token A → Pool 1 → Token B → Pool 2 → Token C).

OmniFi's v4-inspired architecture collapses all liquidity pools across all token pairs and fee tiers into a **single canonical contract: `OmniFiPoolManager`**.

```
+-------------------------------------------------------------------------------------------------+
|                                        OmniFiPoolManager                                        |
|                                                                                                 |
|   Pool Storage:                                                                                 |
|     mapping(PoolId => Pool.State) internal _pools;                                             |
|                                                                                                 |
|   Transient Accounting (Cancun EIP-1153):                                                       |
|     tstore(LOCK_SLOT, 1);                                                                       |
|     tstore(deltaSlot(caller, currency), delta);                                                 |
|                                                                                                 |
|   Token Custody:                                                                                |
|     Consolidated reserves across all pools held in address(this) or native ETH                 |
+-------------------------------------------------------------------------------------------------+
                                      |                       ^
                 unlock(data) callback|                       | settle / take
                                      v                       |
+-------------------------------------------------------------------------------------------------+
|                                        Periphery Router / User                                  |
|   1. unlockCallback:                                                                            |
|      - swap(PoolKey 1, amountIn)  --> PoolManager records delta: +amountIn, -amountOut1         |
|      - swap(PoolKey 2, amountOut1)--> PoolManager records delta: +amountOut1, -amountOut2       |
|      (Notice: intermediate token Out1 delta nets to ZERO without physical transfer!)            |
|   2. Settle negative deltas (send tokens into PoolManager)                                      |
|   3. Take positive deltas (PoolManager transfers final tokens to user)                          |
+-------------------------------------------------------------------------------------------------+
```

### 1.2 Core Architectural Principles

1. **Flash Accounting:** State modifications (swaps, liquidity deposits, burns, donations) do not execute immediate token transfers. Instead, they record signed delta modifications in transient storage. Token custody transfers occur strictly at the boundary through explicit `settle` and `take` operations.
2. **Atomic Netting:** All currency deltas belonging to the unlocked locker must sum to zero by the end of the `unlock` execution context. If any currency retains an unpaid debit (`delta < 0`), the transaction reverts atomically.
3. **Immutability of Core:** Per [ADR-010](../adr/ADR-010-upgradeability.md), `OmniFiPoolManager` is deployed as an immutable contract without proxy upgradeability, preserving trustless custody.
4. **Isolated Release Phase per ADR-004:** In accordance with [ADR-004](../adr/ADR-004-v4-singleton-scope.md), production deployment of arbitrary user hooks and dynamic fee modules is deferred to Release 2. Release 1 delivers the formal specification and foundational scaffold with verified flash accounting invariants and static fee tiers.

---

## 2. Pool Key and Pool ID Derivation

### 2.1 The `PoolKey` Struct

A pool in the singleton is uniquely and deterministically identified by its `PoolKey`:

```solidity
struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;          // Swap fee in hundredths of a bip (denominator 1,000,000)
    int24 tickSpacing;   // Distance between initialized ticks
    address hooks;       // Hook contract address (address(0) in R1)
}
```

### 2.2 Currency Type and Ordering

`Currency` is defined as a user-defined value type wrapping `address`:
```solidity
type Currency is address;
```

- **Native Currency Representation:** Native ETH is represented canonically by `Currency.wrap(address(0))`.
- **Lexicographical Ordering:** To guarantee unique pool identity, currencies must be strictly ordered:
  $$\text{currency0} < \text{currency1}$$
  where `Currency.unwrap(currency0) < Currency.unwrap(currency1)` (address comparison).
- **Validation Rule:** Attempting to initialize or query a pool where `currency0 >= currency1` must revert immediately with `CurrenciesUnsortedOrEqual()`.

### 2.3 Pool ID Computation

The `PoolId` is derived as the Keccak-256 hash of the canonical ABI-encoded `PoolKey`:
$$\text{PoolId} = \text{keccak256}(\text{abi.encode}(\text{key}))$$

```solidity
type PoolId is bytes32;

library PoolIdLibrary {
    function toId(PoolKey memory poolKey) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(poolKey)));
    }
}
```

---

## 3. Flash Accounting & Transient Delta Tracking

### 3.1 Transient Storage Architecture (EIP-1153)

OmniFi targets the Ethereum Cancun hard fork (and compatible Layer 2 networks), utilizing `TSTORE` (opcode `0x5d`) and `TLOAD` (opcode `0x5e`). Transient storage behaves like conventional storage but is completely wiped clean at the conclusion of the transaction, incurring minimal gas costs (100 gas per access vs 2100+ gas for persistent storage).

### 3.2 Transient Storage Slots

The `OmniFiPoolManager` reserves the following transient storage slot layouts:

1. **Lock State Slot:**
   $$\text{LOCK\_SLOT} = \text{keccak256}("omnifi.poolmanager.lock")$$
   - Value `0`: Unlocked (no execution context currently open).
   - Value `1`: Locked (an unlock execution context is actively running).

2. **Delta Tracking Slot:**
   For a given locker address and currency:
   $$\text{DELTA\_SLOT}(caller, currency) = \text{keccak256}(\text{abi.encode}(caller, currency, \text{"omnifi.poolmanager.delta"}))$$
   Stores `int256 delta`:
   - $\text{delta} > 0$: The caller owes tokens to the `PoolManager` (deficit).
   - $\text{delta} < 0$: The `PoolManager` owes tokens to the caller (credit).
   - $\text{delta} = 0$: Balanced (fully settled).

3. **Active Currency Count & List Slot:**
   $$\text{CURRENCY\_COUNT\_SLOT}(caller) = \text{keccak256}(\text{abi.encode}(caller, \text{"omnifi.poolmanager.currencies.count"}))$$
   $$\text{CURRENCY\_ITEM\_SLOT}(caller, index) = \text{keccak256}(\text{abi.encode}(caller, index, \text{"omnifi.poolmanager.currencies.item"}))$$
   Maintains an enumerable list of currencies touched during the lock execution to enable $O(N)$ zero-delta verification at exit.

---

## 4. Unlock and Settlement Lifecycle

### 4.1 Unlock Execution Flow

The entry point for all state modifications is `unlock`:

```solidity
function unlock(bytes calldata data) external returns (bytes memory result);
```

```
Caller (Router)                                      PoolManager
      |                                                   |
      |------------------- unlock(data) ----------------->|
      |                                                   |-- check TLOAD(LOCK_SLOT) == 0
      |                                                   |-- TSTORE(LOCK_SLOT, 1)
      |                                                   |
      |<------------ unlockCallback(data) ----------------|
      |                                                   |
      |-- swap(key, params) ----------------------------->| (modifies reserves, updates deltas)
      |<--------------------------------------------------|
      |                                                   |
      |-- settle(currencyIn){value} --------------------->| (transfers in, clears positive delta)
      |<--------------------------------------------------|
      |                                                   |
      |-- take(currencyOut, recipient, amount) ----------->| (transfers out, clears negative delta)
      |<--------------------------------------------------|
      |                                                   |
      |---------------- return from callback ------------>|
      |                                                   |-- for each currency in locker's list:
      |                                                   |     require(TLOAD(deltaSlot) == 0)
      |                                                   |-- TSTORE(LOCK_SLOT, 0)
      |<----------------- return result ------------------|
```

### 4.2 Flash Accounting Invariants

1. **Non-Reentrant Lock:** Nested invocations of `unlock()` are strictly forbidden. If `TLOAD(LOCK_SLOT) != 0` when `unlock` is invoked, execution reverts immediately with `AlreadyUnlocked()`.
2. **Zero Terminal Delta Invariant:**
   $$\forall c \in \text{TouchedCurrencies}(caller), \quad \text{delta}(caller, c) = 0$$
   If any currency maintains a non-zero balance delta upon return from the callback, execution reverts with `CurrencyDeltaNotZero(currency, delta)`.
3. **No Unpaid Deficit:** The `PoolManager` will never release execution control to the caller with any uncollected debt.
4. **No Locked Capital Extrusion:** Callers cannot `take` more capital than they are credited with through valid state operations.
5. **Transient Atomicity:** Any revert inside the callback or during delta verification reverts the entire EVM transaction state, wiping all transient and persistent modifications.

---

## 5. Settlement and Take Operations

### 5.1 Settling Deficits (`settle`)

When an action leaves the caller with a deficit ($\text{delta} > 0$), the caller must transfer funds to the `PoolManager`:

```solidity
function settle(Currency currency) external payable returns (uint256 paid);
```

#### Execution Logic:
1. Ensure `TLOAD(LOCK_SLOT) == 1`.
2. Read current deficit: $\text{delta} = \text{getDelta}(msg.sender, currency)$.
3. If $\text{delta} \le 0$, revert with `NoExcessDebt()`.
4. If `currency` is Native ETH:
   - Verify `msg.value >= uint256(delta)`.
   - Update delta: $\text{delta}_{\text{new}} = 0$.
   - Any excess `msg.value - uint256(delta)` is returned or credited.
5. If `currency` is an ERC-20 token:
   - Ensure `msg.value == 0`.
   - Determine physical balance difference:
     $$\Delta \text{Balance} = \text{balanceOf}(address(this))_{\text{after}} - \text{balanceOf}(address(this))_{\text{before}}$$
   - Credit caller delta by $\Delta \text{Balance}$.
   - Fee-on-transfer tokens that deliver less than expected are naturally handled because delta credit is based strictly on received balance.

### 5.2 Taking Credits (`take`)

When an action leaves the caller with a surplus credit ($\text{delta} < 0$), the caller may withdraw funds:

```solidity
function take(Currency currency, address to, uint256 amount) external;
```

#### Execution Logic:
1. Ensure `TLOAD(LOCK_SLOT) == 1`.
2. Ensure `to != address(0)`.
3. Read current credit: $\text{delta} = \text{getDelta}(msg.sender, currency)$.
4. Require $-\text{delta} \ge int256(amount)$, else revert with `InsufficientCredit()`.
5. Update delta: $\text{delta}_{\text{new}} = \text{delta} + int256(amount)$.
6. Disburse funds:
   - If `currency` is Native ETH: transfer via low-level `call{value: amount}("")`.
   - If `currency` is ERC-20: transfer via `SafeERC20.safeTransfer(to, amount)`.

---

## 6. Core State Operations Inside the Singleton

All pool state operations (`initialize`, `modifyLiquidity`, `swap`, `donate`) are internal to the lock context or guarded by explicit callers.

### 6.1 `initialize`
```solidity
function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);
```
- Computes `poolId = key.toId()`.
- Reverts if pool already initialized (`_pools[poolId].slot0.sqrtPriceX96 != 0`).
- Validates currencies: `key.currency0 < key.currency1`.
- Validates fee tier: must be one of $\{100, 500, 3000, 10000\}$ per ADR-007.
- Sets initial $\sqrt{P}$ and corresponding tick.

### 6.2 `swap`
```solidity
function swap(
    PoolKey memory key,
    IPoolManager.SwapParams memory params
) external returns (BalanceDelta delta);
```
- Reuses the battle-tested, verified math engines from Phase 5:
  - `SwapMath.computeSwapStep` (fee denominator $1{,}000{,}000$)
  - `SqrtPriceMath`
  - `TickMath`
  - `TickBitmap`
- Calculates amounts: `amount0` and `amount1`.
- Adjusts caller's transient deltas:
  $$\text{delta}(msg.sender, key.currency0) \mathrel{+}= \text{amount0}$$
  $$\text{delta}(msg.sender, key.currency1) \mathrel{+}= \text{amount1}$$
- Returns `BalanceDelta(amount0, amount1)`.

### 6.3 `modifyLiquidity`
```solidity
function modifyLiquidity(
    PoolKey memory key,
    IPoolManager.ModifyLiquidityParams memory params
) external returns (BalanceDelta delta);
```
- Modifies concentrated liquidity position in tick range $[tickLower, tickUpper]$.
- Updates position and global fee growth accumulators.
- Debits or credits `currency0` and `currency1` into caller's transient deltas.

### 6.4 `donate`
```solidity
function donate(
    PoolKey memory key,
    uint256 amount0,
    uint256 amount1
) external returns (BalanceDelta delta);
```
- Directly injects fee amounts into `feeGrowthGlobal0X128` and `feeGrowthGlobal1X128` without modifying active liquidity or price.
- Debits donor's transient deltas: $+amount0, +amount1$.

---

## 7. Native Currency (ETH) Handling

1. **Direct Deposit:** Native ETH is accepted directly via `settle{value: msg.value}(Currency.wrap(address(0)))`.
2. **Native Withdrawal:** When a caller executes `take(Currency.wrap(address(0)), recipient, amount)`, `PoolManager` sends ETH via `.call{value: amount}("")`.
3. **No Phantom ETH:** `PoolManager` explicitly rejects direct, unprompted ETH transfers (`receive()` and `fallback()` revert unless executing within an active `settle`).

---

## 8. Hook Permission & Dynamic Fee Model (Release 2 Specification)

> [!WARNING]
> **Release 1 Status: NOT IMPLEMENTED (per ADR-004)**  
> The hook system and dynamic fee framework specified below are for design completeness and will be activated in Release 2 following a dedicated threat model and specialist audit. In Phase 6 code, all hook addresses must be `address(0)`.

### 8.1 Hook Permission Bitmap
In the full v4 architecture, hook capabilities are encoded into the highest-order bits of the hook contract address:
```
Bit 0: beforeInitialize
Bit 1: afterInitialize
Bit 2: beforeAddLiquidity
Bit 3: afterAddLiquidity
Bit 4: beforeRemoveLiquidity
Bit 5: afterRemoveLiquidity
Bit 6: beforeSwap
Bit 7: afterSwap
Bit 8: beforeDonate
Bit 9: afterDonate
Bit 10: noOp
```
If a `PoolKey` specifies `hooks != address(0)`, the address must match the permissions declared by the pool.

### 8.2 Dynamic Fee Interface
Dynamic fees will be queried through a standard interface:
```solidity
interface IDynamicFeeHook {
    function getFee(address sender, PoolKey calldata key, IPoolManager.SwapParams calldata params)
        external view returns (uint24 fee);
}
```

---

## 9. Security, Threat Analysis & Invariant Summary

| Invariant | Description | Verification Method |
|---|---|---|
| **INV-V4-1: Zero Delta Lock** | No `unlock` returns while any delta $\ne 0$. | Unit + Stateful Invariant Fuzzing |
| **INV-V4-2: Mutex Preservation** | No reentrant entry to `unlock`. | Reentrancy Attack Tests |
| **INV-V4-3: Solvency Conservation** | Total pool vault balance $\ge \sum \text{Reserves} + \sum \text{ProtocolFees}$. | Differential Testing vs CLMM |
| **INV-V4-4: Transient Purity** | All transient slots zeroed post-transaction. | Post-call slot assertions |
| **INV-V4-5: Canonical Identity** | Unique `PoolId` per sorted pair and fee tier. | Cryptographic collision unit tests |

