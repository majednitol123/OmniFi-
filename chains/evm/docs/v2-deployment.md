# OmniFi — EVM V2 Reference AMM Deployment & Operational Guide

## Overview

OmniFi V2 is an internal reference and testing automated market maker implementing the constant-product invariant ($x \cdot y = k$). It is designed to validate end-to-end multi-chain DEX infrastructure before concentrated liquidity (CLMM) is deployed.

Per **ADR-002**, V2 is strictly a reference implementation. It is intended for local development and testnet verification; no mainnet deployment is authorized for Release 1.

---

## Contract Architecture

```
+-------------------------------------------------------------+
|                     OmniFiV2Router                          |
|  - Stateless periphery coordinator                          |
|  - Multi-hop routing (getAmountOut, getAmountIn)            |
|  - Slippage & deadline protection                           |
+-------------------------------------------------------------+
                                |
                                v
+-------------------------------------------------------------+
|                     OmniFiV2Factory                         |
|  - Canonical pair registry (getPair[A][B])                  |
|  - Deterministic CREATE2 pair deployer                      |
|  - Protocol fee fraction and recipient administration       |
+-------------------------------------------------------------+
                                | creates
                                v
+-------------------------------------------------------------+
|                      OmniFiV2Pair                           |
|  - Constant-product engine: x * y = k                       |
|  - Packed reserves (reserve0, reserve1, blockTimestampLast) |
|  - UQ112x112 TWAP cumulative price accumulators             |
|  - Direct protocol fee counter accumulation (0% or 25%)     |
|  - ERC-20 LP token (MINIMUM_LIQUIDITY = 1000 locked)        |
+-------------------------------------------------------------+
```

---

## Local Deployment on Anvil

### 1. Start Local Anvil Node

```bash
anvil --chain-id 31337
```

### 2. Run Deployment Script

```bash
cd chains/evm
forge script script/V2Deploy.s.sol --fork-url http://localhost:8545 --broadcast
```

### 3. Deployed Artifacts

The deployment script registers:
1. `OmniFiV2Factory`: Canonical pool factory with fee recipient
2. `OmniFiV2Router`: Peripheral router for token swaps and liquidity
3. `MockERC20 (mUSDC)`: 6 decimal mock USD Coin
4. `MockERC20 (mWETH)`: 18 decimal mock Wrapped Ether
5. `OmniFiV2Pair`: Canonical pair deployed via `CREATE2` with initial liquidity

---

## Invariants and Safety Guarantees

1. **$k$-Monotonicity:** On every valid swap, $k_{\text{after}} \ge k_{\text{before}}$.
2. **Ceiling Fee on Input:** Fees are rounded UP with $\lceil \frac{\text{amountIn} \cdot \text{fee}}{\text{FEE\_DENOMINATOR}} \rceil$ to prevent micro-swap fee leakage.
3. **Truncating Swap Output:** Output tokens are rounded DOWN to guarantee pool solvency.
4. **Permanent Liquidity Lock:** The first depositor has $1000$ LP units permanently locked to `address(0)`, mitigating share inflation attacks.
5. **Protocol Fee Segregation:** Protocol fees are tracked in dedicated counters and excluded from pool reserves to prevent LP share dilution.
6. **Non-Reentrancy:** Mutex guards protect all state-changing functions (`swap`, `mint`, `burn`, `sync`, `skim`, `collectProtocolFees`).

---

## Test Verification

Run all V2 test suites:

```bash
# Unit and integration tests
forge test --match-path "test/v2/*" -vvv

# Invariant fuzz campaigns
forge test --match-path "test/v2/OmniFiV2Invariant.t.sol"
```

