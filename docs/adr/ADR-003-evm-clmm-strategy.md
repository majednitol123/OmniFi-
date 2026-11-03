# ADR-003: EVM CLMM Strategy

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner, Protocol Lead]
- Related requirements: REQ-004

## Context

The EVM concentrated-liquidity market maker (CLMM) is a required R1 feature. The plan (§14) treats it as "a separate mathematical and security workstream" that "must not be treated as a minor extension of V2." This ADR determines whether the implementation is original, adapted from a reviewed dependency, or integrated from an existing library.

## Decision drivers

- Security — CLMM math errors can cause direct fund loss
- Intellectual property — license compatibility of any reference
- Auditability — original code is easier to audit than a complex fork
- Time to market — original implementation takes longer
- Correctness — established implementations have been battle-tested

## Options considered

### Option A: Original implementation from specification (Recommended)

**Pros:** Full ownership and understanding. Clean audit scope. No license risk. Can be tailored to OmniFi's specific needs. Forces deep understanding of the math.
**Cons:** Highest engineering effort. Risk of novel implementation bugs.

### Option B: Fork/adapt a license-compatible reference

**Pros:** Faster development. Inherits battle-tested code.
**Cons:** License compliance risk. Inherited technical debt. Harder to audit modifications. Must validate the fork is functionally correct.

### Option C: Integrate an existing reviewed library

**Pros:** Fastest path. Potentially already audited.
**Cons:** Black-box dependency. Version lock risk. May not fit OmniFi's architecture. Limited customization.

## Decision

**Recommended: Option A** — Write an original implementation from a formal mathematical specification. Cross-reference established math (e.g., Uniswap v3 whitepaper formulas) for correctness validation, but do not copy code. The Phase 1 specification must include:
- All formulas with integer arithmetic and explicit rounding
- High-precision Python reference model
- Deterministic test vectors
- Differential tests comparing on-chain results with the reference model

## Security implications

- Original implementation requires thorough independent audit
- Must have formal invariant statements before coding
- Differential testing against reference model is mandatory (plan §29.4)
- Fuzz testing tick boundaries, fee growth, and position accounting is mandatory

## Economic implications

- Higher engineering cost upfront (estimated +2 weeks vs fork)
- Lower long-term maintenance cost — no upstream dependency drift

## Operational implications

- Protocol lead must review and sign off on math specification before implementation
- Reference model must be maintained alongside on-chain implementation

## Alternatives rejected

- Option B: License risk and inherited complexity outweigh speed benefit
- Option C: Insufficient control for a core protocol component handling user funds

## Migration / rollback plan

Not applicable — this is a foundational choice. Changing later would require reimplementation.

## Open questions

- Should the reference model be in Python (mpmath/Decimal) or TypeScript (BigInt)?
- What level of test vector coverage is required before implementation begins?

