# OmniFi — Solana Concentrated Liquidity (CLMM) Formal Mathematical Specification

## 1. Mathematical Model & Numerical Representation

The OmniFi Solana Concentrated Liquidity Market Maker (`chains/solana/programs/omnifi_clmm`) implements a discrete geometric tick space:

$$P(i) = 1.0001^i$$

where $i \in [\text{MIN\_TICK}, \text{MAX\_TICK}]$ denotes the discrete tick index.

All on-chain calculations are performed using pure fixed-point integer arithmetic in the Solana BPF environment:
1. **$\text{Q}64.64$ Fixed-Point Square Root Price:**
   $$\sqrt{P}_{\text{X64}} = \lfloor \sqrt{P(i)} \cdot 2^{64} \rfloor = \lfloor 1.0001^{i/2} \cdot 2^{64} \rfloor$$
   Represented in Anchor/Rust as `u128`.
2. **$\text{Q}64.64$ Global & Position Fee Growth:**
   $$f_{\text{X64}} = \lfloor f \cdot 2^{64} \rfloor$$
   Represented in Anchor/Rust as `u128`.

---

## 2. Fundamental Constants & Boundary Envelopes

The tick boundaries and square root price envelopes are bounded to ensure precision while completely preventing 128-bit/256-bit overflow:

| Constant | Value | Description |
|---|---|---|
| `MIN_TICK` | `-443,636` | Lower bound of tick space |
| `MAX_TICK` | `443,636` | Upper bound of tick space |
| `MIN_SQRT_PRICE` | `4,295,048,016` | $\approx \sqrt{1.0001^{-443636}} \cdot 2^{64}$ |
| `MAX_SQRT_PRICE` | `79,226,673,515,401,279,992,447,579,062` | $\approx \sqrt{1.0001^{443636}} \cdot 2^{64}$ |
| `FEE_DENOMINATOR` | `1,000,000` | 100% precision scale (1 ppm = 0.0001%) |
| `MAX_PROTOCOL_FEE_FRACTION` | `250,000` | 25% max protocol fee cut |
| `TICK_ARRAY_SIZE` | `88` | Number of ticks packed per `TickArray` account |

---

## 3. Supported Fee Tiers & Tick Spacing Rules

Each CLMM pool is uniquely identified by the tuple:
$$\text{PoolKey} = (\text{token\_mint\_0}, \text{token\_mint\_1}, \text{fee\_tier})$$
where $\text{token\_mint\_0} < \text{token\_mint\_1}$ in lexicographical order:

| Fee Tier | Fee (ppm) | Fee (%) | Tick Spacing ($t_s$) | Ticks per Array ($88 \cdot t_s$) |
|---|---|---|---|---|
| **Ultra-Stable** | `100` | 0.01% | `1` | `88` |
| **Correlated** | `500` | 0.05% | `10` | `880` |
| **Standard** | `3,000` | 0.30% | `60` | `5,280` |
| **Exotic** | `10,000` | 1.00% | `200` | `17,600` |

All positions $[i_l, i_u]$ must satisfy:
$$i_l < i_u, \quad i_l \ge \text{MIN\_TICK}, \quad i_u \le \text{MAX\_TICK}, \quad i_l \pmod{t_s} == 0, \quad i_u \pmod{t_s} == 0$$

---

## 4. Program Derived Addresses (PDAs) & Account Structure

To ensure deterministic discovery and security boundaries:

| Account | PDA Seeds | Signer in CPI? | Purpose |
|---|---|---|---|
| `GlobalConfig` | `["clmm_config"]` | No | Administrative authority, fee config, pause switches |
| `PoolState` | `["clmm_pool", mint0, mint1, fee_tier_le]` | No | Pool state, sqrt price, tick, fee growth, liquidity |
| `PoolAuthority` | `["clmm_authority", pool_state_pubkey]` | **Yes** | Owns token vaults, signs outbound CPI transfers |
| `TickArray` | `["omnifi-tick-array", pool_state_pubkey, start_tick_le]` | No | 88 discrete tick slots, net/gross liquidity |
| `PositionState` | `["omnifi-position", pool_state_pubkey, owner, tick_lower_le, tick_upper_le]` | No | User position liquidity & fee growth snapshots |

---

## 5. Tick Array Segmentation & Contiguity Validation

### 5.1 Start Tick Index Formula

The start tick index for any arbitrary tick $i$ is aligned using mathematical floor division:
$$\text{ticks\_per\_array} = \text{TICK\_ARRAY\_SIZE} \times t_s$$

$$\text{start\_tick}(i) = \begin{cases} 
\lfloor i / \text{ticks\_per\_array} \rfloor \times \text{ticks\_per\_array} & \text{if } i \ge 0 \\
\lfloor (i - \text{ticks\_per\_array} + 1) / \text{ticks\_per\_array} \rfloor \times \text{ticks\_per\_array} & \text{if } i < 0 \text{ and } i \pmod{\text{ticks\_per\_array}} \ne 0 \\
i & \text{if } i < 0 \text{ and } i \pmod{\text{ticks\_per\_array}} == 0
\end{cases}$$

### 5.2 Contiguity Verification During Swaps

When a swap crosses multiple tick arrays, all arrays in `ctx.remaining_accounts` must be verified for sequential adjacency in trade direction:
- **Zero For One ($0 \to 1$, Price Decreasing):**
  $$\text{start\_tick}_k = \text{start\_tick}_{k-1} - \text{ticks\_per\_array}$$
- **One For Zero ($1 \to 0$, Price Increasing):**
  $$\text{start\_tick}_k = \text{start\_tick}_{k-1} + \text{ticks\_per\_array}$$

If any array deviates from this expected start tick index, the swap immediately aborts with `ClmmError::InvalidTickArraySequence`.

---

## 6. Virtual Liquidity & Amount Computations

Within an active interval $[\sqrt{P}_l, \sqrt{P}_u]$ with current price $\sqrt{P}_c$:

### 6.1 Below Range ($\sqrt{P}_c \le \sqrt{P}_l$)
$$\Delta x = \frac{L \cdot (\sqrt{P}_u - \sqrt{P}_l)}{\sqrt{P}_l \cdot \sqrt{P}_u \cdot 2^{-64}}, \quad \Delta y = 0$$

### 6.2 Above Range ($\sqrt{P}_c \ge \sqrt{P}_u$)
$$\Delta x = 0, \quad \Delta y = \frac{L \cdot (\sqrt{P}_u - \sqrt{P}_l)}{2^{64}}$$

### 6.3 In Range ($\sqrt{P}_l < \sqrt{P}_c < \sqrt{P}_u$)
$$\Delta x = \frac{L \cdot (\sqrt{P}_u - \sqrt{P}_c)}{\sqrt{P}_c \cdot \sqrt{P}_u \cdot 2^{-64}}, \quad \Delta y = \frac{L \cdot (\sqrt{P}_c - \sqrt{P}_l)}{2^{64}}$$

---

## 7. Swap Execution & Exact-Output Fulfillment Guarantees (F-06 Resolution)

A swap step executes from $\sqrt{P}_c$ to $\sqrt{P}_{\text{target}}$:

### 7.1 Exact-Input Swaps
$$\Delta x_{\text{net}} = \left\lfloor \frac{\Delta x_{\text{in}} \cdot (\text{FEE\_DENOMINATOR} - \text{fee})}{\text{FEE\_DENOMINATOR}} \right\rfloor$$
$$\Delta y_{\text{out}} = \frac{L \cdot (\sqrt{P}_c - \sqrt{P}_{\text{next}})}{2^{64}}$$
Slippage requirement:
$$\text{total\_amount\_out} \ge \text{other\_amount\_threshold}$$

### 7.2 Exact-Output Swaps (Full Fulfillment Invariant)
To eliminate partial fills and protect users from truncated swaps:
1. `amount_remaining` must reach exactly zero:
   $$\text{amount\_remaining} == 0$$
   If the loop finishes with `amount_remaining > 0` (e.g. tick arrays exhausted or price limit reached before full fill), the transaction reverts with `ClmmError::SlippageExceeded`.
2. Input tokens transferred from user must not exceed threshold:
   $$\text{total\_amount\_in} + \text{total\_fee\_amount} \le \text{other\_amount\_threshold}$$

---

## 8. Protocol Fee Isolation & Settlement

Protocol fees are computed as a fraction of the total swap fee:
$$\text{protocol\_fee} = \left\lfloor \frac{\text{total\_fee\_amount} \cdot f_{\text{proto}}}{\text{FEE\_DENOMINATOR}} \right\rfloor$$

Protocol fees accumulate strictly in `pool.protocol_fees_token_0` and `pool.protocol_fees_token_1` without inflating position fee growth:
$$\text{fee\_growth\_global\_x64} = \text{fee\_growth\_global\_x64} + \left\lfloor \frac{(\text{total\_fee\_amount} - \text{protocol\_fee}) \cdot 2^{64}}{L} \right\rfloor$$

When `collect_protocol_fees` is invoked, fees are transferred to the protocol treasury, leaving virtual pool liquidity and position fee indices unaffected.
