# OmniFi EVM Concentrated Liquidity (CLMM) — Formal Mathematical Specification

## 1. Mathematical Model & Numerical Representation

OmniFi Concentrated Liquidity Automated Market Maker (CLMM) operates on the discrete geometric price curve:
$$P(i) = 1.0001^i$$
where $i \in \mathbb{Z}$ denotes the discrete tick index.

All on-chain calculations use fixed-point arithmetic in two primary representations:
1. **$\text{Q}64.96$ Fixed-Point Square Root Price:**
   $$\sqrt{P}_{\text{X96}} = \lfloor \sqrt{P(i)} \cdot 2^{96} \rfloor = \lfloor 1.0001^{i/2} \cdot 2^{96} \rfloor$$
   Represented in Solidity as `uint160`.
2. **$\text{Q}128.128$ Fixed-Point Global Fee Growth:**
   $$f_{\text{X128}} = \lfloor f \cdot 2^{128} \rfloor$$
   Represented in Solidity as `uint256`.

---

## 2. Fundamental Constants & Boundary Envelopes

The tick indices and square root price limits are bounded to prevent 256-bit overflow during intermediate products:

| Constant | Value | Hexadecimal Representation | Mathematical Significance |
| :--- | :--- | :--- | :--- |
| `MIN_TICK` | `-887272` | `-0x0D89E8` | Lower boundary for valid tick space ($P \approx 10^{-38.5}$) |
| `MAX_TICK` | `887272` | `0x0D89E8` | Upper boundary for valid tick space ($P \approx 10^{38.5}$) |
| `MIN_SQRT_PRICE` | `4295128739` | `0x0000000000000000000000000000000100000000` | $\approx \sqrt{1.0001^{-887272}} \cdot 2^{96}$ |
| `MAX_SQRT_PRICE` | `1461446703485210103287273052203988822378723970342` | `0xFFFD8963EFD1FC6A506488496D1A8C2E4F` | $\approx \sqrt{1.0001^{887272}} \cdot 2^{96}$ |
| `FEE_DENOMINATOR` | `1000000` | `0x0F4240` | 1e6 pips precision (1 pip = 0.0001%) |
| `Q96` | $2^{96}$ | `0x1000000000000000000000000` | $79228162514264337593543950336$ |
| `Q128` | $2^{128}$ | `0x100000000000000000000000000000000` | $340282366920938463463374607431768211456$ |

---

## 3. Supported Fee Tiers & Tick Spacing Rules

Each pool is uniquely defined by the canonical tuple:
$$\text{PoolKey} = (\text{token0}, \text{token1}, \text{fee})$$
where $\text{token0} < \text{token1}$ (lexicographical order) and $\text{fee} \in \{100, 500, 3000, 10000\}$.

| Fee Tier | Fee (pips) | Fee Percentage | Tick Spacing ($t_s$) | Valid Ticks Condition |
| :--- | :--- | :--- | :--- | :--- |
| **Ultra-Stable** | `100` | 0.01% | `1` | $i \pmod 1 == 0$ |
| **Correlated** | `500` | 0.05% | `10` | $i \pmod{10} == 0$ |
| **Standard** | `3000` | 0.30% | `60` | $i \pmod{60} == 0$ |
| **Exotic** | `10000` | 1.00% | `200` | $i \pmod{200} == 0$ |

All initialized position boundaries $[i_l, i_u]$ must satisfy:
$$i_l < i_u, \quad i_l \ge \text{MIN\_TICK}, \quad i_u \le \text{MAX\_TICK}, \quad i_l \pmod{t_s} == 0, \quad i_u \pmod{t_s} == 0$$

---

## 4. Virtual Reserves & Liquidity Amounts

Within an active price interval $[\sqrt{P}_l, \sqrt{P}_u]$, real token amounts $\Delta x$ and $\Delta y$ relate to virtual liquidity $L$ via:

### 4.1 Below Range ($\sqrt{P}_{\text{current}} \le \sqrt{P}_l$)
The position holds only Token 0:
$$\Delta x = \frac{L \cdot (\sqrt{P}_u - \sqrt{P}_l)}{\sqrt{P}_l \cdot \sqrt{P}_u}, \quad \Delta y = 0$$

In fixed-point arithmetic (`LiquidityAmounts.sol`):
$$\Delta x = \text{FullMath.mulDivRoundingUp}\left(\text{FullMath.mulDivRoundingUp}(L \cdot 2^{96}, \sqrt{P}_u - \sqrt{P}_l, \sqrt{P}_u), 1, \sqrt{P}_l\right)$$

### 4.2 Above Range ($\sqrt{P}_{\text{current}} \ge \sqrt{P}_u$)
The position holds only Token 1:
$$\Delta x = 0, \quad \Delta y = L \cdot (\sqrt{P}_u - \sqrt{P}_l)$$

In fixed-point arithmetic:
$$\Delta y = \text{FullMath.mulDivRoundingUp}(L, \sqrt{P}_u - \sqrt{P}_l, 2^{96})$$

### 4.3 In Range ($\sqrt{P}_l < \sqrt{P}_{\text{current}} < \sqrt{P}_u$)
The position holds both tokens:
$$\Delta x = \frac{L \cdot (\sqrt{P}_u - \sqrt{P}_{\text{current}})}{\sqrt{P}_{\text{current}} \cdot \sqrt{P}_u}, \quad \Delta y = L \cdot (\sqrt{P}_{\text{current}} - \sqrt{P}_l)$$

---

## 5. Swap Step Execution & Fee Dynamics

A swap traverses discrete tick ranges from current price $\sqrt{P}_c$ to target limit $\sqrt{P}_{\text{target}}$ or the next initialized tick boundary $\sqrt{P}_{\text{next}}$.

### 5.1 Exact Input Swap ($\Delta x_{\text{in}} > 0$)
1. Net input available after fee:
   $$\Delta x_{\text{net}} = \left\lfloor \Delta x_{\text{in}} \cdot \left(1 - \frac{\text{fee}}{1\,000\,000}\right) \right\rfloor$$
2. Next price computation (`SqrtPriceMath.getNextSqrtPriceFromInput`):
   $$\sqrt{P}_{\text{next}} = \frac{L \cdot \sqrt{P}_c \cdot 2^{96}}{L \cdot 2^{96} + \Delta x_{\text{net}} \cdot \sqrt{P}_c}$$
3. Fee deduction:
   $$\text{feeAmount} = \Delta x_{\text{in}} - \Delta x_{\text{net}}$$

### 5.2 Exact Output Swap ($\Delta y_{\text{out}} > 0$)
1. Next price computation (`SqrtPriceMath.getNextSqrtPriceFromOutput`):
   $$\sqrt{P}_{\text{next}} = \sqrt{P}_c - \left\lceil \frac{\Delta y_{\text{out}} \cdot 2^{96}}{L} \right\rceil$$
2. Required input amount before fee:
   $$\Delta x_{\text{raw}} = \frac{L \cdot (\sqrt{P}_c - \sqrt{P}_{\text{next}})}{\sqrt{P}_c \cdot \sqrt{P}_{\text{next}}}$$
3. Gross input required with fee:
   $$\Delta x_{\text{in}} = \left\lceil \frac{\Delta x_{\text{raw}} \cdot 1\,000\,000}{1\,000\,000 - \text{fee}} \right\rceil$$
   $$\text{feeAmount} = \Delta x_{\text{in}} - \Delta x_{\text{raw}}$$

---

## 6. Tick Bitmap & Discrete Tick Crossing

Active ticks are indexed in a two-level bitmap mapping $i_{\text{word}} = \lfloor i / (t_s \cdot 256) \rfloor \implies \text{uint256}$.

When a swap reaches $\sqrt{P}_{\text{next}}$ at an initialized tick:
1. **Tick Crossing:**
   $$\Delta L_{\text{net}} = \text{ticks}[i].\text{liquidityNet}$$
   $$L_{\text{new}} = \begin{cases} L_{\text{old}} - \Delta L_{\text{net}}, & \text{if zeroForOne} \\ L_{\text{old}} + \Delta L_{\text{net}}, & \text{if oneForZero} \end{cases}$$
2. **Outside Fee Growth Inversion:**
   $$f_{o,0}(i) = f_{g,0} - f_{o,0}(i)$$
   $$f_{o,1}(i) = f_{g,1} - f_{o,1}(i)$$
3. **Current Tick Shift:**
   $$i_{\text{current}} = \begin{cases} i_{\text{next}} - 1, & \text{if zeroForOne} \\ i_{\text{next}}, & \text{if oneForZero} \end{cases}$$

---

## 7. Fee Growth Accounting Inside Range $[i_l, i_u]$

For any position bounded by $[i_l, i_u]$ at current tick $i_c$, the fee growth earned per unit of liquidity $f_{\text{inside}}$ is calculated as:
$$f_{\text{inside}} = f_{\text{global}} - f_{\text{below}}(i_l) - f_{\text{above}}(i_u)$$

Where the outside contributions are conditionally defined relative to $i_c$:
$$f_{\text{below}}(i) = \begin{cases} f_o(i), & \text{if } i_c \ge i \\ f_{\text{global}} - f_o(i), & \text{if } i_c < i \end{cases}$$

$$f_{\text{above}}(i) = \begin{cases} f_{\text{global}} - f_o(i), & \text{if } i_c \ge i \\ f_o(i), & \text{if } i_c < i \end{cases}$$

### Accumulated Fees for Position:
$$\text{tokensOwed} = \left\lfloor \frac{(f_{\text{inside}} - f_{\text{inside,last}}) \cdot L_{\text{position}}}{2^{128}} \right\rfloor$$

---

## 8. Protocol Fee Deductions

The protocol fee is governed by `slot0.protocolFeeFraction` $\in \{0, 1, 2, 3, 4\}$:
$$\text{ProtocolFeeRate} = \frac{\text{protocolFeeFraction}}{4} \times \text{LPFee}$$

- Fraction `0`: 0% protocol cut (100% to LPs).
- Fraction `1`: 25% of the fee to protocol (75% to LPs).
- Fraction `2`: 50% of the fee to protocol (50% to LPs).
- Fraction `4`: 100% of the fee to protocol (0% to LPs).

Protocol fees accumulate directly in `protocolFees.token0` and `protocolFees.token1` and can only be withdrawn by the factory owner or designated fee recipient via `collectProtocolFees()`.

---

## 9. ERC-721 Position Manager Architecture

The `OmniFiPositionManager` wraps concentrated liquidity allocations into ERC-721 non-fungible tokens:
- **Token ID:** Monotonically increasing identifier `_nextId++`.
- **State per Token:**
  ```solidity
  struct Position {
      uint96 nonce;
      address operator;
      address token0;
      address token1;
      uint24 fee;
      int24 tickLower;
      int24 tickUpper;
      uint128 liquidity;
      uint256 feeGrowthInside0LastX128;
      uint256 feeGrowthInside1LastX128;
      uint128 tokensOwed0;
      uint128 tokensOwed1;
  }
  ```
- **Lifecycle Guarantees:**
  - `mint()`: Transfers tokens via `IOmniFiMintCallback` and issues NFT.
  - `increaseLiquidity()`: Compounds capital into existing NFT position.
  - `decreaseLiquidity()`: Withdraws liquidity and records owed fees/principal.
  - `collect()`: Transfers accrued principal and fees to specified recipient.
  - `burn()`: Permanently destroys NFT only when `liquidity == 0` and `tokensOwed == 0`.

---

## 10. Verification & Formal Invariants

The specification is proven by 71 Foundry test suites including:
1. `invariant_feeGrowthMonotonic`: Proves $f_{g,0}$ and $f_{g,1}$ never decrease.
2. `invariant_protocolFeesCovered`: Proves protocol fee withdrawal never depletes pool reserves.
3. `invariant_tickAndPriceWithinBounds`: Proves $\sqrt{P}$ and $i$ remain strictly within $[\text{MIN\_SQRT\_PRICE}, \text{MAX\_SQRT\_PRICE}]$ and $[\text{MIN\_TICK}, \text{MAX\_TICK}]$.
4. `CLMMDifferentialTest`: Bit-exact comparison against reference Python test vectors (`packages/test-vectors/clmm/vectors.json`).

