# ADR-015: Token Authorization (Permit2 Strategy)

- Status: Accepted
- Date: 2026-11-01
- Owners: [Protocol Lead, Security Reviewer]
- Related requirements: REQ-011

## Context

The plan (§17) states that Permit2 is "an integration choice, not a feature to reimplement casually." Users must authorize token spending before swaps. This ADR decides whether to use standard ERC-20 approvals, integrate an existing Permit2 deployment, or build a custom system.

## Decision drivers

- UX — Permit2 enables single-approval convenience across multiple tokens
- Security — custom signature systems are high-risk (§17: "Do not build a custom signature system without specialist review")
- Deployment availability — Permit2 is not deployed on all chains
- Smart-contract wallet compatibility — EIP-1271 support needed
- Solana — Permit2 is an EVM concept; Solana uses different authorization patterns

## Options considered

### Option A: Standard ERC-20 approve/transferFrom only
**Pros:** Simple. Universal. Well-understood. No signature risk.
**Cons:** Requires per-token approval transactions. Higher gas cost over time.

### Option B: Integrate existing Permit2 deployment where available (Recommended)
**Pros:** Better UX. Battle-tested. Already audited and deployed on major EVM chains.
**Cons:** Not available on all chains. Must verify deployment address per network.

### Option C: Build custom signature-based authorization
**Cons:** Plan §17 explicitly warns against this. Requires specialist review. High risk.

## Decision

**Recommended: Option B with Option A fallback.**

- On EVM chains where Permit2 is deployed and verified: integrate Permit2 for token authorization
- On EVM chains without Permit2: fall back to standard ERC-20 approve
- On Solana: use native token program delegation/approval mechanisms
- Never ask users to sign opaque messages — all signature requests must include human-readable explanation
- Domain separation, nonce model, deadline, replay protection per §17

## Security implications

- Must verify Permit2 deployment address on each chain — do not trust unverified contracts
- Signature requests must be human-readable (§17)
- Must handle signature malleability
- Must support smart-contract wallet signatures (EIP-1271)
- Revocation and expiration must be supported

## Economic implications

- Permit2 reduces per-swap gas cost after initial approval
- One-time Permit2 approval covers all tokens

## Operational implications

- Frontend must detect Permit2 availability per network
- SDK must abstract approval flow (Permit2 vs standard approve)
- Error handling for rejected signatures, expired permits

## Alternatives rejected

- Option A alone: inferior UX on chains where Permit2 is available
- Option C: explicitly prohibited by plan §17 without specialist review

## Open questions

- Verified Permit2 deployment addresses for target chains (after ADR-001 is accepted)
- Smart-contract wallet market share — is EIP-1271 support critical for launch?

