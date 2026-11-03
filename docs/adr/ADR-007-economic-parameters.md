# ADR-007: Economic Parameters

- Status: Accepted
- Date: 2026-11-01
- Owners: [Pending assignment]
- Related requirements: plan.md §4.1, §13.2, §14.1

## Context

OmniFi must define the economic parameters that govern pool creation, swap fees, tick spacing, and protocol revenue for Release 1. These parameters directly affect LP profitability, trader costs, protocol sustainability, and resistance to spam or manipulation. Because R1 does not include governance, all parameter changes require operator action through authorized administrative controls.

Key parameters requiring decisions:

1. **Fee tiers** — the set of swap fee rates available for pool creation.
2. **Tick spacing** — the granularity of price ranges in concentrated-liquidity pools (coupled to fee tier).
3. **Protocol fee** — the fraction of swap fees directed to the protocol treasury.
4. **Pool creation permissions** — who may create new pools and under what conditions.

## Decision drivers

- **LP economics:** Fee tiers must match asset volatility profiles; too few tiers leave LPs undercompensated, too many fragment liquidity.
- **Capital efficiency:** Tick spacing determines how precisely LPs can concentrate liquidity. Finer spacing increases efficiency but raises gas/compute costs.
- **Spam resistance:** Permissionless pool creation invites spam tokens, dust pools, and phishing pairs.
- **Simplicity:** R1 has no governance; parameters must be manageable by a small operator team.
- **Precedent:** Uniswap v3's fee tiers (0.01%, 0.05%, 0.30%, 1.00%) are well-studied and market-validated.
- **Protocol sustainability:** A protocol fee mechanism must exist even if initially set to zero.

## Options considered

### Fee tier options

#### Option A: Fixed fee tier set (Recommended)

**Description:** Define a fixed set of fee tiers at deployment. Each fee tier has a corresponding tick spacing. New tiers require a contract upgrade or authorized admin call.

| Fee tier | Tick spacing | Target pair profile |
|---|---|---|
| 0.01% (1 bps) | 1 | Stable-stable (USDC/USDT) |
| 0.05% (5 bps) | 10 | Correlated assets (ETH/stETH) |
| 0.30% (30 bps) | 60 | Standard volatile pairs (ETH/USDC) |
| 1.00% (100 bps) | 200 | Exotic / high-volatility pairs |

**Pros:**
- Simple to implement, test, and audit.
- Market-proven tier structure.
- Predictable for LPs and integrators.
- Bounded state space for testing.

**Cons:**
- Cannot adapt to novel asset profiles without admin action.
- May miss optimal fee points for specific markets.

#### Option B: Configurable per pool within bounds

**Description:** Pool creators choose any fee within a defined range (e.g., 0.01% to 5.00%) with a minimum tick spacing floor.

**Pros:**
- Maximum flexibility for pool creators.
- Can optimize fees per market.

**Cons:**
- Liquidity fragmentation across many fee points.
- Harder to route efficiently (quote engine must enumerate more pools).
- Larger attack surface for manipulation via adversarial fee selection.
- Significantly more complex testing matrix.

#### Option C: Governance-controlled fee tiers

**Description:** Fee tiers are managed by on-chain governance vote.

**Pros:**
- Decentralized parameter management.
- Community-driven adaptation.

**Cons:**
- R1 has no governance system (plan.md §2.2 explicitly excludes it).
- Cannot be implemented in R1 timeline.
- Adds attack surface (governance manipulation).

### Pool creation permission options

#### Option A: Fully permissionless

**Description:** Any address may create a pool for any token pair and fee tier.

**Pros:**
- Maximum openness and composability.
- No gatekeeping.

**Cons:**
- Spam pools with dust liquidity pollute the pool registry.
- Phishing tokens can create pools mimicking legitimate pairs.
- Router and indexer must handle large numbers of low-quality pools.
- No cost barrier to griefing.

#### Option B: Allowlisted creators only

**Description:** Only authorized addresses may call pool creation functions.

**Pros:**
- Strong spam control.
- Curated pool quality.

**Cons:**
- Centralization bottleneck.
- Poor UX for legitimate projects wanting to list.
- Contradicts permissionless DeFi ethos.

#### Option C: Permissionless with spam controls (Recommended)

**Description:** Any address may create a pool, subject to:

1. **Minimum initial liquidity** — pool creator must seed a minimum amount to activate the pool.
2. **Pool creation fee** — a small fee (denominated in native currency) burned or sent to the protocol treasury.
3. **Duplicate prevention** — only one pool per (token0, token1, fee tier) tuple.
4. **Token validation** — tokens must pass basic standard-compliance checks (see ADR-006).

**Pros:**
- Preserves permissionless access.
- Economic cost deters spam without blocking legitimate use.
- Duplicate prevention consolidates liquidity.
- Compatible with ADR-006 token policy.

**Cons:**
- Minimum liquidity and creation fee values require tuning (too high = barrier, too low = ineffective).
- Does not prevent all phishing pairs (frontend filtering also needed).

## Decision

**Recommended:**
- **Fee tiers:** Option A — Fixed fee tier set (0.01%, 0.05%, 0.30%, 1.00%).
- **Pool creation:** Option C — Permissionless with spam controls.

### Protocol fee policy

- The protocol fee switch must exist in R1 contracts but should be initialized to **zero**.
- The maximum protocol fee must be capped in the contract (recommended: ≤ 25% of LP fees, i.e., protocol takes at most 1/4 of the swap fee).
- Only an authorized admin (multisig + timelock per ADR-010) may activate or change the protocol fee.
- Protocol fees accrue to a designated treasury address, not to individual admin accounts.
- Fee accounting must be separate from LP fee accounting and independently auditable.

### Additional parameters

- **Tick spacing:** Immutably paired to fee tier at pool creation. Solana CLMM uses the same logical mapping stored in the pool account.
- **Solana parity:** Fee tiers mirror EVM for cross-chain UX consistency. Pool creation fee denominated in SOL. Minimum liquidity thresholds may differ; exact values TBD.

## Security implications

- Fixed fee tiers reduce attack surface vs. arbitrary fee selection. Duplicate pool prevention eliminates liquidity-splitting attacks.
- Protocol fee cap prevents a compromised admin from extracting excessive value. Timelock on fee changes gives LPs exit time.
- Pool creation fees deter costless spam. Minimum liquidity mitigates first-depositor manipulation in CLMM pools.

## Economic implications

- 4-tier structure covers >95% of observed DeFi pair profiles. Protocol fee at zero initially maximizes LP attraction.
- Pool creation fee (recommended 0.01–0.1 ETH equivalent; TBD per network) balances spam deterrence against accessibility.
- Minimum initial liquidity (recommended \$100–\$1,000 equivalent; TBD) prevents dust pools. Revenue projections depend on fee activation timing.

## Operational implications

- Admin manages protocol fee via multisig + timelock. Fee tier additions require contract-level change.
- Monitoring: pools created per day, average initial liquidity, protocol fee accrual, fee tier utilization.
- Creation fee and minimum liquidity parameters should be admin-adjustable per network.

## Alternatives rejected

- **Configurable fees (Option B)** rejected for R1 due to liquidity fragmentation, routing complexity, and expanded testing burden.
- **Governance-controlled fees (Option C)** rejected because R1 explicitly excludes governance (plan.md §2.2).
- **Allowlisted pool creators (Option B)** rejected due to centralization and UX friction.
- **Fully permissionless creation (Option A)** rejected due to spam risk without any economic deterrent.

## Migration / rollback plan

- Adding new fee tiers in R2+ requires deploying an updated factory or enabling a new tier on the existing factory (if the contract supports it). Existing pools are unaffected.
- Protocol fee activation is reversible: set back to zero via admin multisig.
- Pool creation fee adjustments are immediate and do not affect existing pools.
- If governance is introduced in R2, fee tier management can be transferred to the governance contract.

## Open questions

1. What are the exact pool creation fee amounts per network?
2. What are the exact minimum initial liquidity thresholds per network?
3. Should a 0.005% (0.5 bps) tier be added for hyper-correlated pairs?
4. Should the protocol fee cap be 25% or lower?
5. Should pool creation fees be burned or sent to treasury?
6. Should there be a maximum number of pools per token pair (across fee tiers)?
