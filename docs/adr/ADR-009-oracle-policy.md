# ADR-009: Oracle Policy

- Status: Accepted
- Date: 2026-11-01
- Owners: [Pending assignment]
- Related requirements: plan.md §4.1, §14.1

## Context

Concentrated-liquidity AMMs can embed oracle functionality — typically a time-weighted average price (TWAP) observation array — into the pool contract. Uniswap v3 includes a ring buffer of price-tick observations that external contracts can query to compute TWAPs over arbitrary intervals. This decision determines whether OmniFi's R1 DEX core should include such oracle functionality.

### What TWAP oracles provide

- On-chain price feeds derived from actual trade execution.
- Manipulation-resistant price averaging over configurable time windows.
- Used by lending protocols, derivatives, liquidation engines, and governance for price inputs.

### What TWAP oracles cost

- **Storage:** Each observation slot costs ~20,000 gas to initialize (SSTORE). Uniswap v3 allows up to 65,535 observations per pool.
- **Compute:** Every swap must write to the observation array, adding ~5,000–10,000 gas per swap.
- **Complexity:** Observation logic interacts with tick crossing, timestamp handling, and cardinality management.
- **Attack surface:** TWAP oracles are a known manipulation target (multi-block attacks, sandwich attacks on low-liquidity pools).
- **Solana:** Observation arrays on Solana consume account space and compute units. Solana's slot-based timing differs from EVM block timestamps.

## Decision drivers

- **R1 product scope:** OmniFi R1 is a swap and liquidity DEX (plan.md §2.1). It does not include lending, derivatives, or governance — the primary consumers of on-chain TWAP oracles.
- **Security posture:** Oracle manipulation is a top-10 DeFi attack vector. Including oracles without consumers increases risk for no immediate benefit.
- **Gas/compute efficiency:** Oracle writes on every swap increase costs for traders and LPs.
- **Future extensibility:** Can oracles be added later without breaking existing pools?
- **Composability:** Third-party protocols may want to use OmniFi pools as price sources.

## Options considered

### Option A: Include TWAP observation array (Uniswap v3 style)

**Description:** Embed a ring buffer of `(blockTimestamp, tickCumulative, liquidityCumulative)` observations in each pool. Expose `observe()` and `increaseObservationCardinality()` functions. Every swap writes to the array.

**Pros:**
- Full Uniswap v3 oracle compatibility — known and trusted by integrators.
- Enables third-party protocols to use OmniFi pools as price oracles from day one.
- Proves OmniFi is a "real" CLMM with full feature parity.

**Cons:**
- 5,000–10,000 gas overhead per swap with no R1 consumer.
- Observation cardinality initialization costs are borne by the first user to expand it.
- TWAP manipulation on low-liquidity pools is a documented attack vector (multi-block manipulation, sandwich attacks).
- Adds ~200–400 lines of complex code to the pool contract, expanding audit scope.
- Solana implementation requires different timing semantics (slots vs. timestamps) and consumes valuable account space.
- If no OmniFi product consumes the oracle in R1, the feature is dead weight.

### Option B: Minimal observation for internal use only

**Description:** Store only the most recent price observation (last tick, last timestamp) for internal use (e.g., time-weighted fee adjustment or analytics). Do not expose a public `observe()` function.

**Pros:**
- Low overhead — single storage write, no ring buffer.
- Useful for internal monitoring and analytics.
- Does not expose a public oracle surface for manipulation.

**Cons:**
- Still adds per-swap storage writes.
- "Internal only" observation is hard to keep internal — pressure to expose it will come quickly.
- Limited utility: a single observation is insufficient for TWAP calculation.
- Adds code complexity without the full benefit of a proper oracle.

### Option C: No oracle in R1 DEX core (Recommended)

**Description:** Do not include any oracle or observation functionality in the R1 pool contracts. The pool tracks only the current price (sqrt price and tick) as required for swap execution. Price history is available off-chain via the indexer and event logs.

**Pros:**
- Simplest pool implementation — reduced code, reduced audit scope.
- Lowest gas/compute cost per swap.
- Eliminates an entire attack surface class (TWAP manipulation).
- Off-chain price feeds (Chainlink, Pyth, Switchboard, or OmniFi's own indexer) are available for any consumer that needs price history.
- Oracles can be added in a future release via a wrapper contract (EVM) or separate program (Solana) without modifying pool core.

**Cons:**
- Third-party protocols cannot use OmniFi pools as on-chain price oracles.
- Reduces perceived feature parity with Uniswap v3.
- If oracle demand emerges quickly, adding it post-deployment requires a new contract version or wrapper.

## Decision

**Recommended: Option C — No oracle in R1 DEX core.**

### Rationale

1. **No R1 consumer exists.** OmniFi R1 does not include lending, derivatives, governance, or any feature that requires an on-chain TWAP oracle.
2. **Cost without benefit.** Every swap would pay gas for observation writes that no contract reads.
3. **Security budget.** The R1 audit should focus on swap correctness, fee accounting, and position management — not oracle manipulation resistance.
4. **Off-chain alternatives.** The indexer (plan.md §8, services/indexer-*) captures all swap events with timestamps. Any off-chain system can reconstruct price history from events.
5. **Additive, not subtractive.** Oracles can be introduced in R2 via:
   - EVM: A wrapper contract that reads pool state and maintains its own observation array.
   - Solana: A separate oracle program that subscribes to pool state changes.
   - Neither approach requires modifying the core pool contract.

### What R1 does provide

- Current pool price (sqrtPriceX96 / sqrtPriceX64 and current tick) readable on-chain.
- Swap events with input/output amounts and post-swap price — sufficient for off-chain price construction.
- Pool state queries via SDK for real-time price.

## Security implications

- **Positive:** Removing oracle logic eliminates TWAP manipulation as an attack vector. This is significant — TWAP manipulation has caused >$100M in DeFi losses across protocols.
- **Positive:** Reduced code surface means fewer lines to audit and fewer potential bugs.
- **Neutral:** Third-party protocols that rely on OmniFi as a price source must use off-chain feeds or external oracles, which have their own trust assumptions.
- **Risk:** If a future OmniFi product (e.g., lending in R3) needs an on-chain oracle, it must not retroactively trust pools that were not designed with oracle security guarantees.

## Economic implications

- **Gas savings:** ~5,000–10,000 gas per swap on EVM. At 50 gwei and \$3,000 ETH, this saves \$0.15–\$0.30 per swap — material at scale.
- **Compute savings:** On Solana, eliminating observation writes saves ~10,000–20,000 compute units per swap, enabling more transactions per block.
- **Integrator impact:** Protocols that would have used OmniFi pools as oracle sources must find alternatives. This may reduce some integration demand.
- **Simplicity premium:** Faster audit, faster deployment, lower total R1 cost.

## Operational implications

- The indexer must emit structured price history data sufficient for off-chain TWAP construction.
- SDK should include a `getPriceHistory(pool, startTime, endTime)` method backed by the indexer.
- Documentation must clearly state that OmniFi R1 pools do not provide on-chain oracle functionality.
- Monitoring must track current pool prices and detect anomalies, using event-based feeds rather than on-chain observation queries.

## Alternatives rejected

- **Option A (full TWAP array)** rejected because R1 has no consumer for oracle data, and the feature adds gas cost, code complexity, and a high-risk attack surface with no immediate benefit.
- **Option B (minimal observation)** rejected as a half-measure: it adds per-swap cost without enabling meaningful oracle use, and creates pressure to expose the data publicly before it's properly secured.

## Migration / rollback plan

- **Adding oracles in R2/R3:** Deploy a separate oracle adapter contract/program that reads pool state and maintains its own observation ring buffer. This contract can be independently audited without touching pool core.
- **EVM:** Oracle adapter calls `pool.slot0()` on each block (or is triggered by swap callbacks in a v4-style hook) and writes observations.
- **Solana:** Oracle program uses CPI or crank-based updates to read pool state and write observation accounts.
- No changes to R1 pool contracts are required to add oracle support later.

## Open questions

1. Should the R1 indexer provide a TWAP calculation endpoint for off-chain consumers?
2. Should pool events include a cumulative tick field to make off-chain TWAP reconstruction easier (even without on-chain observation)?
3. If a v4-style hook system is implemented, should an "oracle hook" be one of the first approved hooks?
4. What external oracle services (Chainlink, Pyth, Switchboard) should be recommended for integrators needing price feeds?
5. Should the SDK include a volatility or TWAP estimation utility using indexed event data?
