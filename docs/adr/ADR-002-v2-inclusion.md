# ADR-002: V2 AMM Inclusion

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner]
- Related requirements: REQ-003

## Context

The plan (§13) describes a V2-style constant-product AMM as a "reference implementation" that "may be included in Release 1 only if product requirements justify it." This ADR determines whether V2 is a full product feature, a test-only reference, or deferred entirely. The decision affects Phase 1 math specification scope and Phase 4 implementation.

## Decision drivers

- Product value — concentrated liquidity is strictly superior for capital efficiency
- Engineering cost — V2 is simpler but still requires full security review
- Testing utility — V2 provides a simpler AMM to validate infrastructure (indexer, router, SDK)
- User expectation — some users prefer constant-product simplicity

## Options considered

### Option A: Include V2 as full product feature

**Pros:** Simpler onboarding for basic LPs. Fallback if CLMM has issues.
**Cons:** Two pool types to audit, index, route, and maintain. Dilutes engineering focus.

### Option B: Include V2 as test/reference only (Recommended)

**Pros:** Validates AMM infrastructure with simpler math. Not exposed to production users initially. Can be promoted to production later. Reduces audit scope.
**Cons:** Engineering effort for something not user-facing in R1.

### Option C: Defer V2 entirely

**Pros:** Maximum focus on CLMM. Smallest audit surface.
**Cons:** Loses the simpler reference for validating indexer/router/SDK integration.

## Decision

**Recommended: Option B** — Build V2 as an internal test/reference AMM. Use it to validate the full stack (factory → pool → router → indexer → SDK → frontend) with simpler math before tackling CLMM integration. Do not expose to production users in R1 unless later promoted via a new ADR.

## Security implications

- V2 still requires security review even as a reference — it handles token transfers
- Smaller audit scope since it's not user-facing
- Serves as a testing ground for reentrancy, fee accounting, and token compatibility patterns

## Economic implications

- No production fee revenue from V2 in R1
- Reduces audit cost by limiting scope

## Operational implications

- V2 contracts deploy to test networks only
- Indexer must support V2 events for development/testing
- Router can use V2 pools in test environments

## Alternatives rejected

- Option A: Unnecessary product complexity when CLMM is the primary value proposition
- Option C: Loses valuable infrastructure validation opportunity

## Migration / rollback plan

If V2 is later needed as a product feature, promote it via a new ADR. The code and infrastructure already exist from the reference implementation.

## Open questions

- Should V2 pools be available on testnet frontends for internal testing?

