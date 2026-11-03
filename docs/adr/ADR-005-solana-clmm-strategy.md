# ADR-005: Solana CLMM Strategy

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner, Solana Engineer]
- Related requirements: REQ-007

## Context

The plan (§22) requires Solana concentrated-liquidity pools with a "separate specification and implementation." The Solana account model, transaction size limits, and compute budgets create fundamentally different constraints than EVM. This ADR determines whether the Solana CLMM is built from scratch, adapted from an existing open-source design, or integrated directly.

## Decision drivers

- Solana-specific constraints — tick arrays, PDAs, compute limits, account locks
- Security — Solana CLMM has unique attack surface (account substitution, CPI escalation)
- Existing designs — Orca Whirlpools and other Solana CLMMs are battle-tested
- License — any adapted code must be license-compatible
- Ownership — must be able to modify and audit independently

## Options considered

### Option A: Original Solana-native implementation

**Pros:** Full ownership. Tailored to OmniFi's architecture.
**Cons:** Highest effort. Solana CLMM is significantly more complex than EVM due to account model.

### Option B: Adapt a reviewed open-source Solana CLMM (Recommended)

**Pros:** Leverages battle-tested tick-array and position designs. Faster development. Known compute budgets.
**Cons:** Must verify license compatibility. Must deeply understand adapted code for audit. Fork maintenance burden.

### Option C: Integrate an existing audited program

**Pros:** Fastest path. Already audited.
**Cons:** No ownership. Cannot customize. Dependency on external program upgrades. Plan §0.1 rule 7 requires ADR approval for third-party protocol substitution.

## Decision

**Recommended: Option B** — Study existing open-source Solana CLMM designs (e.g., Whirlpool architecture patterns), understand the tick-array model and account design, then implement OmniFi's own version informed by those designs. Do not copy code — use architectural patterns with original implementation.

The Phase 1 specification must address Solana-specific concerns:
- Tick-array PDA derivation and size
- Maximum arrays per swap transaction
- Account-lock contention
- Compute-unit budget per instruction
- Transaction size limits with Address Lookup Tables

## Security implications

- Solana-specific audit required (separate from EVM audit)
- Account validation is critical — every PDA must be derived and verified on-chain
- CPI boundaries must be explicitly documented
- Token-2022 extension policy applies to CLMM pools

## Economic implications

- Moderate engineering cost — lower than Option A, higher than Option C
- Requires Solana-specialized auditor (separate cost from EVM audit)

## Operational implications

- Solana engineer must have deep familiarity with tick-array patterns
- Compute budget monitoring is essential — Solana transactions can fail on compute limits
- Account resolution client must handle tick-array lookup

## Alternatives rejected

- Option A: Excessive effort given the well-studied nature of Solana CLMM architecture
- Option C: Violates ownership and customization requirements per plan §0.1 rule 7

## Migration / rollback plan

Not applicable — foundational architectural choice.

## Open questions

- Which open-source Solana CLMM designs have compatible licenses?
- What is the target compute budget per swap instruction?

