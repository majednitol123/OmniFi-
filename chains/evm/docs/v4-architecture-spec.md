# OmniFi EVM v4-Inspired Singleton AMM — Formal Architecture & Flash Accounting Specification

## 1. Executive Summary & Core Paradigm

The OmniFi v4-Inspired Singleton AMM operates as a monolithic multi-pool vault contract (`OmniFiPoolManager`) targeting the Cancun EVM (`solc 0.8.26`). By leveraging Cancun's transient storage opcodes (`TSTORE` and `TLOAD`, EIP-1153), the protocol eliminates physical token transfers between intermediary pools during multi-hop route executions.

All state transitions occur within an isolated **Flash Accounting Execution Window** where callers accrue transient currency balance deltas that must be exactly settled before control exits the window:
$$\forall c \in \text{TouchedCurrencies}(\text{locker}): \quad \Delta_c(\text{locker}) = 0$$

---

## 2. Pool Identity & Key Derivation

Each liquidity pool inside the singleton engine is uniquely identified by the immutable 5-tuple:
$$\text{PoolKey} = (\text{currency0}, \text{currency1}, \text{fee}, \text{tickSpacing}, \text{hooks})$$

### 2.1 Currency Representation
Tokens are typed using the value type `Currency` (`type Currency is address`):
- **Native ETH:** Represented canonically by `Currency.wrap(address(0))`.
- **ERC-20 Tokens:** Represented by `Currency.wrap(tokenAddress)`.

### 2.2 Canonical Ordering Rule
Every valid pool must satisfy strict lexicographical ordering:
$$\text{currency0} < \text{currency1}$$
Any initialization attempt with $\text{currency0} \ge \text{currency1}$ reverts with `CurrenciesUnsortedOrEqual()`.

### 2.3 Pool ID Derivation
The unique identifier `PoolId` is computed via deterministic keccak-256 hashing:
$$\text{PoolId} = \text{keccak256}\left(\text{abi.encode}(\text{currency0}, \text{currency1}, \text{fee}, \text{tickSpacing}, \text{hooks})\right)$$

---

## 3. Transient Storage Slot Layout (Cancun EIP-1153)

All transient variables exist solely during transaction execution and are cleared automatically by the EVM runtime at transaction termination with zero residual SSTORE gas cost.

| Slot Constant | Calculation Formula | Type | Purpose |
| :--- | :--- | :--- | :--- |
| `LOCK_SLOT` | `keccak256("omnifi.poolmanager.lock")` | `uint256` | `1` when unlocked, `0` when locked |
| `ACTIVE_LOCKER_SLOT` | `keccak256("omnifi.poolmanager.activelocker")` | `address` | `msg.sender` of active `unlock()` invocation |
| `DELTA_SLOT` | `keccak256(abi.encode(locker, currency, "omnifi.poolmanager.delta"))` | `int256` | Signed balance delta for caller & currency |
| `CURRENCY_COUNT_SLOT` | `keccak256(abi.encode(locker, "omnifi.poolmanager.currencycount"))` | `uint256` | Number of distinct currencies touched by caller |
| `CURRENCY_ITEM_SLOT` | `keccak256(abi.encode(locker, index, "omnifi.poolmanager.currencyitem"))` | `address` | Address of touched currency at index |

---

## 4. Flash Accounting Execution Lifecycle

The execution lifecycle follows a strict sandwich pattern:

```
[External Caller]
       │
       ▼  calls unlock(data)
┌─────────────────────────────────────────────────────────────┐
│ 1. Verify LOCK_SLOT == 0 (Revert if AlreadyUnlocked)       │
│ 2. Set LOCK_SLOT = 1                                        │
│ 3. Set ACTIVE_LOCKER_SLOT = msg.sender                      │
│                                                             │
│ 4. Execute IUnlockCallback(msg.sender).unlockCallback(data) │
│    ├── swap(...) ──────► accretes Δ_in > 0, Δ_out < 0      │
│    ├── modifyLiquidity ► accretes liquidity deltas          │
│    ├── settle(c) ──────► pays Δ_c > 0 (debt to pool)       │
│    └── take(c) ────────► withdraws -Δ_c > 0 (credit)       │
│                                                             │
│ 5. TERMINAL ZERO-DELTA INVARIANT VERIFICATION:              │
│    For each c in TouchedCurrencies(msg.sender):             │
│        if Δ_c(msg.sender) != 0:                             │
│            revert CurrencyDeltaNotZero(c, Δ_c)              │
│                                                             │
│ 6. Clear LOCK_SLOT = 0, ACTIVE_LOCKER_SLOT = 0              │
└─────────────────────────────────────────────────────────────┘
       │
       ▼  returns result to Caller
```

---

## 5. Mathematical Delta Netting Equations

### 5.1 Balance Delta Representation
A `BalanceDelta` packs two signed 128-bit integers into a single 256-bit word:
$$\text{BalanceDelta} = (\Delta_0 \ll 128) \mid (\Delta_1 \ \& \ (2^{128} - 1))$$

- **Positive Delta ($\Delta_c > 0$):** The caller owes tokens to `OmniFiPoolManager`.
- **Negative Delta ($\Delta_c < 0$):** The caller is owed tokens from `OmniFiPoolManager`.

### 5.2 Settlement Operations
To eliminate positive debt ($\Delta_c > 0$):
- **For ERC-20:** Call `settle(currency)`. The contract executes:
  $$\text{TransferHelper.safeTransferFrom}(\text{currency}, \text{msg.sender}, \text{address(this)}, \Delta_c)$$
  $$\Delta_c \leftarrow \Delta_c - \text{owed} = 0$$
- **For Native ETH:** Call `settle{value: owed}(CurrencyLibrary.NATIVE)`. If `msg.value > owed`, the excess is automatically refunded to `msg.sender`.

### 5.3 Take Operations
To claim negative credit ($\Delta_c < 0$):
- Call `take(currency, recipient, amount)`.
- Condition: $\text{amount} \le -\Delta_c$. If $\text{amount} > -\Delta_c$, reverts with `InsufficientCredit()`.
- State update: $\Delta_c \leftarrow \Delta_c + \text{amount}$.
- Action: Transfers tokens or ETH to `recipient`.

---

## 6. Formal Invariants & Security Guarantees

### Invariant 1: Terminal Delta Zero
Upon exiting `unlock()`, every currency delta associated with the active locker must equal zero:
$$\forall c \in \text{TouchedCurrencies}(\text{msg.sender}): \quad \text{TransientStorage.getDelta}(\text{msg.sender}, c) = 0$$
Failure reverts the entire call frame, protecting pool funds.

### Invariant 2: Active Locker Caller Isolation
During the unlocked window, all state-modifying methods (`modifyLiquidity`, `swap`, `donate`, `settle`, `take`) enforce:
$$\text{msg.sender} == \text{TransientStorage.tload}(\text{ACTIVE\_LOCKER\_SLOT})$$
Secondary contracts or malicious reentrant callers are rejected immediately with `NotActiveLocker()`.

### Invariant 3: Single-Frame Lock Window
Nested invocations of `unlock()` are strictly prohibited:
$$\text{TransientStorage.tload}(\text{LOCK\_SLOT}) \neq 0 \implies \text{revert AlreadyUnlocked()}$$

### Invariant 4: ADR-004 Hooks Deferral
In Release 1, user-supplied hooks are rejected:
$$\text{key.hooks} \neq \text{address(0)} \implies \text{revert HooksNotSupportedInR1()}$$
This prevents hook-based reentrancy and malicious fee redirection attacks pending comprehensive Release 2 audit.

---

## 7. Verification Matrix

The v4 singleton implementation is verified by:
1. `FlashAccountingTest`: Proves revert on unpaid debt, active locker isolation, nested unlock prevention, and direct ETH settlement with excess refund.
2. `PoolOperationsTest`: Verifies swap virtual price movement, concentrated liquidity modifications, and donation delta handling.
3. `OmniFiPoolManagerTest`: Validates pool initialization, parameter boundaries, and protocol fee controls.
4. `V4InvariantTest`: Stateful Foundry invariant fuzz testing over 2048 randomized calls.

