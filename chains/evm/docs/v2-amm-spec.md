# OmniFi V2 Reference AMM — Technical & Mathematical Specification

**Status:** Approved — Protocol Engineering Specification v1.0  
**Target:** EVM Chains (Ethereum Sepolia, Base Sepolia)  
**Contract Package:** `chains/evm/src/v2/`  

---

## 1. Overview & Protocol Purpose

OmniFi V2 provides a battle-tested, constant-product Automated Market Maker ($x \cdot y = k$) reference implementation for standardized trading pairs. While OmniFi defaults to Concentrated Liquidity (CLMM) for capital efficiency, the V2 engine acts as the foundational, deterministic fallback AMM and liquidity benchmark across supported EVM networks.

---

## 2. Mathematical Model & Swap Invariant

### 2.1 The Constant-Product Formula
For token reserves $x$ and $y$, the swap invariant with a $0.30\%$ ($30\text{ bps}$) swap fee is:

$$(x_1 - 0.003 \cdot \Delta x) \cdot (y_1 - 0.003 \cdot \Delta y) \ge x_0 \cdot y_0$$

In fixed-point integer arithmetic with a denominator of $1,000,000$ and fee parameter `fee = 3000`:

$$\text{balanceAdjusted}_0 = (\text{balance}_0 + \text{protoFee}_0) \cdot 1,000,000 - (\Delta x_{\text{in}} \cdot 3,000)$$
$$\text{balanceAdjusted}_1 = (\text{balance}_1 + \text{protoFee}_1) \cdot 1,000,000 - (\Delta y_{\text{in}} \cdot 3,000)$$

$$\frac{\text{balanceAdjusted}_0 \cdot \text{balanceAdjusted}_1}{1,000,000} \ge \text{reserve}_0 \cdot \text{reserve}_1 \cdot 1,000,000$$

### 2.2 Output Amount Calculation (`getAmountOut`)
Given exact input $\Delta x_{\text{in}}$:

$$\Delta y_{\text{out}} = \frac{\Delta x_{\text{in}} \cdot 997 \cdot y_0}{x_0 \cdot 1000 + \Delta x_{\text{in}} \cdot 997}$$

### 2.3 Input Amount Calculation (`getAmountIn`)
Given exact output $\Delta y_{\text{out}}$:

$$\Delta x_{\text{in}} = \frac{x_0 \cdot \Delta y_{\text{out}} \cdot 1000}{(y_0 - \Delta y_{\text{out}}) \cdot 997} + 1$$

---

## 3. Protocol Fee Mechanism & Accounting Separation

Unlike legacy Uniswap V2 (which inflates LP tokens upon mint/burn via $\sqrt{k}$ dilution), OmniFi V2 implements **direct on-chain fee accumulation** per ADR-007:

1. **Fee Calculation**: Upon each swap, the protocol takes a fraction (configured by `protocolFeeFraction` in the Factory, default $1/6$th of the $30\text{ bps}$ fee $= 5\text{ bps}$).
2. **Reserve Isolation**: Collected protocol fees are stored in a distinct mapping `protocolFees[token]`.
3. **Desynchronization Prevention**:
   $$\text{balance}_0 = \text{IERC20Minimal}(\text{token0}).\text{balanceOf}(\text{address}(\text{this})) - \text{protocolFees}[\text{token0}]$$
   This guarantees that withdrawing protocol fees via `collectProtocolFees()` never reduces the stored pool reserves, protecting liquidity provider shares from invariant desynchronization.

---

## 4. Minimum Liquidity & Anti-Inflation Protection

To prevent the classic first-depositor inflation attack (where an attacker deposits 1 wei, burns minimal LP shares, and inflates LP share price):
- Upon the initial deposit ($\text{totalSupply} == 0$), `MINIMUM_LIQUIDITY` ($1,000$ wei of LP shares) is permanently minted to `address(0)`:
  $$\text{initialLiquidity} = \lfloor\sqrt{\Delta x \cdot \Delta y}\rfloor$$
  $$\text{liquidityToMinter} = \text{initialLiquidity} - 1,000$$
- This permanently pins the minimum valuation of pool shares and prevents ratio manipulation.

---

## 5. TWAP Oracle & Accumulator Mechanics

Each pair maintains cumulative price accumulators using UQ112.112 fixed-point representation:

$$\text{price0CumulativeLast} \mathrel{+}= \left(\frac{\text{reserve}_1 \ll 112}{\text{reserve}_0}\right) \cdot \Delta t$$
$$\text{price1CumulativeLast} \mathrel{+}= \left(\frac{\text{reserve}_0 \ll 112}{\text{reserve}_1}\right) \cdot \Delta t$$

- Cumulative prices update once per block (when $\Delta t > 0$).
- Calculations use Solidity `unchecked` block arithmetic, relying on natural 256-bit modular overflow so that downstream consumers can calculate time-weighted average prices cleanly via:
  $$\text{TWAP} = \frac{\text{priceCumulative}_{t_2} - \text{priceCumulative}_{t_1}}{t_2 - t_1}$$

---

## 6. Factory Architecture & CREATE2 Determinism

- **Deterministic Address Derivation**: Pairs are deployed via `create2` using salt `keccak256(abi.encodePacked(token0, token1))`.
- **Public vs. Governance Gatekeeping (ADR-002 Reconciled)**:
  - On-chain `createPair` is public to guarantee identical CREATE2 addresses across all EVM networks for client routers and quoter contracts.
  - Off-chain UI and API gatekeeping restricts pool creation during bootstrapping via `feature-flags.json: poolCreationRestricted: true`.

---

## 7. Test Coverage & Verification

OmniFi V2 maintains 100% test pass rate across 63 Foundry test suites:
- Invariant testing (`OmniFiV2Invariant.t.sol`): $k$ monotonicity, minimum liquidity lock, and reserve balance conservation across 2,048 randomized fuzzing calls.
- Differential testing (`OmniFiV2Differential.t.sol`): Exact parity with Uniswap V2 reference math for asymmetric, large impact, and high-frequency swaps.

