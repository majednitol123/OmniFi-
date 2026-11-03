# OmniFi — EVM v4-Inspired Singleton Architecture & Operational Guide

## Overview

OmniFi v4 is a singleton concentrated-liquidity Automated Market Maker targeting Cancun EVM (`solc 0.8.26` with EIP-1153 `TSTORE` and `TLOAD`). By holding all liquidity pools in a single canonical contract (`OmniFiPoolManager`), OmniFi eliminates physical token transfers between intermediate pools during multi-hop swaps, reducing gas costs and unlocking flash accounting.

> [!NOTE]
> Per **ADR-004**, full release of user-supplied permissionless hooks and dynamic fee algorithms is deferred to Release 2. Release 1 implements the core singleton engine, flash accounting lifecycle, transient delta tracking, static fee tiers (1, 5, 30, and 100 bps), and verified accounting invariants.

---

## Architecture Diagram

```
+-----------------------------------------------------------------------------------+
|                                  Periphery / Router                               |
|   - Implements IUnlockCallback                                                    |
|   - Multi-hop swap orchestration                                                  |
|   - Calls settle() to pay debts and take() to withdraw credits                     |
+-----------------------------------------------------------------------------------+
                                          |
                      unlock(data)        |  settle() / take()
                                          v
+-----------------------------------------------------------------------------------+
|                                 OmniFiPoolManager                                 |
|   - Singleton contract holding all pools in internal storage                      |
|   - Transient Storage (EIP-1153) manages active lock and caller currency deltas   |
|   - Core Math: TickMath, SqrtPriceMath, SwapMath, FullMath, LiquidityMath         |
|   - Zero-Delta Invariant: Reverts if any delta remains unsettled at unlock exit   |
+-----------------------------------------------------------------------------------+
```

---

## Key Invariants & Safety Guarantees

1. **Zero Terminal Delta Invariant:** Every currency balance delta belonging to the caller must equal zero upon completion of the `unlockCallback`. Unsettled debt triggers immediate revert.
2. **Reentrancy Immunity:** `unlock()` cannot be called while already inside an active unlock context (`AlreadyUnlocked()`).
3. **No Uncredited Withdrawal:** `take()` cannot withdraw any amount exceeding the caller's transient surplus credit (`InsufficientCredit()`).
4. **Transient Storage Sanitization:** Because transient storage (EIP-1153) is completely discarded at transaction termination by the EVM runtime, no lingering deltas can leak across transactions.
5. **Native ETH Parity:** Native ETH is supported canonically as `Currency.wrap(address(0))` via `settle{value: owed}()` with automatic refund of excess value.

---

## Deployment & Verification

Run the local deployment script:
```bash
cd chains/evm
forge script script/V4Deploy.s.sol:V4DeployScript
```

Run all v4 test suites:
```bash
forge test --match-path "test/v4/*" -vvv
```

