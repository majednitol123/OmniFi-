# OmniFi — EVM Concentrated Liquidity (CLMM) Deployment & Operational Guide

## Overview

OmniFi CLMM is a production-grade Concentrated Liquidity Automated Market Maker for EVM blockchains targeting the Cancun EVM (`solc 0.8.26`). It delivers optimal capital efficiency by restricting liquidity allocation to discrete tick ranges ($p = 1.0001^{\text{tick}}$) with a fee denominator of $1{,}000{,}000$ (1e6).

Per **ADR-002** and **ADR-004**, OmniFi CLMM Release 1 focuses on the core isolated pool architecture without singleton or hooks overhead, backed by extensive differential testing against our reference Python model and stateful invariant fuzzing.

---

## Contract Architecture

```
                                +-----------------------------------+
                                |        OmniFiQuoter               |
                                |  - Non-stateful swap simulation   |
                                |  - Try/catch callback revert      |
                                +-----------------------------------+
                                                  |
+-----------------------------------+             | simulates
|       OmniFiSwapRouter            |             |
|  - Stateless periphery router     |             |
|  - exactInputSingle / exactInput  |             |
|  - exactOutputSingle / exactOutput|             |
|  - Slippage & deadline protection |             |
+-----------------------------------+             |
                 |                                |
                 | swaps                          |
                 v                                v
+-------------------------------------------------------------------+
|                           OmniFiPool                              |
|  - Core Concentrated Liquidity Engine                             |
|  - Math: TickMath, SqrtPriceMath, SwapMath, FullMath, LiquidityMath|
|  - Range tracking: Tick, TickBitmap (256-bit word search)         |
|  - Protocol fee collection (0% - 25% protocol cut)                |
|  - Reentrancy lock mutex                                          |
+-------------------------------------------------------------------+
                 ^                                ^
                 | manages liquidity              | creates via CREATE2
                 |                                |
+-----------------------------------+   +---------------------------+
|      OmniFiPositionManager        |   |    OmniFiPoolFactory      |
|  - ERC-721 Position NFTs          |   |  - Canonical pool registry|
|  - mint / increaseLiquidity       |<--|  - Fee tier management    |
|  - decreaseLiquidity / collect    |   |  - Protocol fee setter    |
|  - burn (when liquidity = 0)      |   |  - Deterministic CREATE2  |
+-----------------------------------+   +---------------------------+
```

---

## Supported Fee Tiers & Tick Spacings

| Fee Tier | Fee (pips) | Fee Percentage | Tick Spacing | Target Asset Pair Type |
| :--- | :--- | :--- | :--- | :--- |
| **Ultra-Stable** | `100` | 0.01% | `1` | Pegged assets (USDC/USDT, DAI/USDC) |
| **Stable / Correlated** | `500` | 0.05% | `10` | Correlated assets (ETH/stETH, wBTC/tBTC) |
| **Standard / Volatile** | `3000` | 0.30% | `60` | Major volatile pairs (ETH/USDC, BTC/USDT) |
| **Exotic / High Volatility** | `10000` | 1.00% | `200` | Low-cap, long-tail tokens |

*Note: Custom fee tiers can be enabled by the Factory Owner via `enableFeeTier(fee, tickSpacing)`.*

---

## Local Deployment on Anvil

### 1. Launch Anvil Local Node

```bash
anvil --chain-id 31337
```

### 2. Execute Deployment Script

Run from repository root:

```bash
cd chains/evm
forge script script/CLMMDeploy.s.sol:CLMMDeployScript \
  --fork-url http://localhost:8545 \
  --broadcast
```

### 3. Deployed Contracts & Typical Addresses (Anvil Key 0)

1. **`OmniFiPoolFactory`**: Canonical registry and CREATE2 deployer: `0x5FbDB2315678afecb367f032d93F642f64180aa3`
2. **`OmniFiPositionManager`**: ERC-721 concentrated LP manager: `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`
3. **`OmniFiSwapRouter`**: Periphery multi-hop swap router: `0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0`
4. **`OmniFiQuoter`**: Simulation quoter: `0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9`
5. **`MockERC20 (mUSDC)`**: Mock USD Coin (6 decimals): `0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9`
6. **`MockERC20 (mWETH)`**: Mock Wrapped Ether (18 decimals): `0x5FC8d32690cc91D4c39d9d3abcBD16989F875707`
7. **`OmniFiPool (0.30%)`**: Canonical mUSDC/mWETH pool: `0x30231f5a9bB01490564A0B879c5ACc14Be3C7B7D`

---

## Operational Workflows

### 1. Minting Concentrated Liquidity (ERC-721 NFT)

```solidity
posManager.mint(
    IOmniFiPositionManager.MintParams({
        token0: address(usdc),
        token1: address(weth),
        fee: 3000,
        tickLower: -1200,
        tickUpper: 1200,
        amount0Desired: 10_000 * 1e6,
        amount1Desired: 3.33 * 1e18,
        amount0Min: 9_900 * 1e6,
        amount1Min: 3.30 * 1e18,
        recipient: msg.sender,
        deadline: block.timestamp + 300
    })
);
```

### 2. Simulating a Swap Quote via `OmniFiQuoter`

```solidity
uint256 expectedOut = quoter.quoteExactInputSingle(
    address(usdc),
    address(weth),
    3000,
    1_000 * 1e6,
    0 // No price limit
);
```

### 3. Executing an Exact-Input Swap via `OmniFiSwapRouter`

```solidity
router.exactInputSingle(
    IOmniFiSwapRouter.ExactInputSingleParams({
        tokenIn: address(usdc),
        tokenOut: address(weth),
        fee: 3000,
        recipient: msg.sender,
        deadline: block.timestamp + 300,
        amountIn: 1_000 * 1e6,
        amountOutMinimum: expectedOut * 995 / 1000, // 0.5% max slippage
        sqrtPriceLimitX96: 0
    })
);
```

### 4. Collecting Accrued Trading Fees

```solidity
posManager.collect(
    IOmniFiPositionManager.CollectParams({
        tokenId: 1,
        recipient: msg.sender,
        amount0Max: type(uint128).max,
        amount1Max: type(uint128).max
    })
);
```

---

## Core Invariants & Safety Guarantees

1. **Global Fee Growth Monotonicity:**
   $F_{global, 0}(t_{n+1}) \ge F_{global, 0}(t_n)$ and $F_{global, 1}(t_{n+1}) \ge F_{global, 1}(t_n)$ strictly across every swap step.
2. **Tick & Price Boundaries:**
   $\text{MIN\_TICK} = -887272 \le \text{tick} \le 887272 = \text{MAX\_TICK}$
   $\text{MIN\_SQRT\_PRICE} = 4295128739 \le \sqrt{P} \le 1461446703485210103287273052203988822378723970342 = \text{MAX\_SQRT\_PRICE}$.
3. **Rounding Principles:**
   - Token amounts owed to the pool (mint, swap input) round **UP** ($\lceil \cdot \rceil$).
   - Token amounts paid out by the pool (burn, swap output) round **DOWN** ($\lfloor \cdot \rfloor$).
   - Pool liquidity rounds **DOWN** on mint to prevent over-crediting claims.
4. **Reentrancy Protection:**
   The pool maintains an internal reentrancy lock mutex (`slot0.unlocked`) across all state-modifying routines (`swap`, `mint`, `burn`, `collect`).
5. **Protocol Fee Isolation:**
   Protocol fees are segregated into dedicated counters and do not interfere with LP fee growth calculations.

---

## Verification & Test Execution

Run the complete EVM test suite:

```bash
# Run all CLMM tests (unit, differential, and invariant fuzzing)
forge test --match-path "test/clmm/*" -vvv

# Run differential verification vs reference vectors
forge test --match-contract CLMMDifferentialTest -vvv

# Run stateful invariant fuzz campaign (2000+ transitions)
forge test --match-contract CLMMInvariantTest -vvv

# Run the complete test suite (V2 + CLMM)
forge test
```

