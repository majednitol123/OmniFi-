# ADR-004: v4 Singleton Scope

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner, Protocol Lead]
- Related requirements: REQ-005

## Context

The plan (§15) describes a v4-inspired singleton pool architecture as "a major independent workstream" requiring flash accounting, hook systems, dynamic fees, and transient storage. Section §46 explicitly states: "This phase may be deferred if it threatens the delivery or security of the core DEX. Do not rush it."

## Decision drivers

- Complexity — flash accounting, hook permissions, and transient storage are high-risk features
- Security — each element requires its own threat model and invariant proofs
- Timeline — v4 singleton adds an estimated 13+ days to Phase 1 specification alone
- Core DEX delivery — CLMM is the primary product; v4 is an optimization
- EVM version dependency — transient storage requires EVM chains supporting EIP-1153

## Options considered

### Option A: Full v4 implementation in R1

**Pros:** Most advanced architecture. Gas savings from singleton pattern.
**Cons:** Massive security surface. Delays CLMM delivery. Hook system is explicitly high-risk per plan §15.3. Requires specialist audit.

### Option B: Limited subset in R1 (singleton without hooks)

**Pros:** Gas savings without hook risk.
**Cons:** Still requires flash accounting specification and audit. Partial implementation may create confusion.

### Option C: Defer to Release 2 (Recommended)

**Pros:** Core DEX ships faster with CLMM. v4 gets proper specification and audit in a dedicated release. No hook risk in R1. Smaller audit scope.
**Cons:** Misses gas optimization from singleton pattern in R1.

## Decision

**Recommended: Option C** — Defer the v4-inspired singleton to Release 2 or later. Focus R1 on delivering a solid CLMM with per-pool contracts. This follows plan §46 guidance.

Phase 1 will NOT produce `docs/protocol/evm-singleton-spec.md`. Track C tasks are removed from the Phase 1 timeline.

## Security implications

- Dramatically reduces R1 audit scope
- Eliminates flash accounting, hook, and transient storage attack vectors from R1
- v4 will get its own threat model and dedicated audit when implemented

## Economic implications

- Per-pool deployment costs remain (no singleton gas savings in R1)
- Reduced audit cost for R1

## Operational implications

- Simplifies deployment — no singleton pool manager contract
- Simplifies indexer — standard per-pool events only
- Phase 6 is removed from R1 delivery timeline

## Alternatives rejected

- Option A: Plan §46 explicitly warns against rushing this. The hook system alone requires independent threat model per §15.3.
- Option B: Partial implementation creates confusion and still requires flash accounting audit.

## Migration / rollback plan

When v4 is implemented in a later release, existing CLMM pools continue operating. New pools can use the singleton architecture. Migration of existing pools is optional and requires its own ADR.

## Open questions

- Should v4 specification work begin during R1 development (in parallel) or wait for R2 kickoff?

---

## Addendum (Phase 5 Technical Prototype)

- **Date:** 2026-11-03
- **Status:** Implemented as Technical Demonstration & Research Prototype

Following the stabilization of the core CLMM contracts and invariant verification suites, an advanced prototype of the Uniswap v4-inspired singleton was implemented in `chains/evm/src/v4/OmniFiPoolManager.sol` to validate Cancun EIP-1153 transient storage (`tload`/`tstore`), lock-unlock-settle flash accounting, and net-zero delta invariants.

**Implementation Highlights:**
1. **Singleton Storage:** Consolidated pool key mappings into a single contract to evaluate multi-hop gas minimization.
2. **Transient Flash Accounting:** Enforces reentrancy locking and per-currency net settlement (`delta == 0`) inside `unlock()` callbacks using transient storage.
3. **Safety Invariants:** Full invariant testing (`chains/evm/test/v4/V4Invariant.t.sol`) verifies delta clearance across arbitrary fuzz actions before production mainnet migration.
4. **Mainnet Rollout Status:** Mainnet initial liquidity deployment remains on canonical CLMM per-pool contracts (`OmniFiPool.sol`), with `OmniFiPoolManager.sol` retained as our verified reference architecture for Cancun-enabled EVM networks.

