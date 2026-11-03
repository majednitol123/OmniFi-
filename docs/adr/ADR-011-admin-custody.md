# ADR-011: Admin Custody and Signing Model

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner, Security Reviewer]
- Related requirements: REQ-028

## Context

The plan (§35) requires separate roles for deployer, protocol admin, guardian/pause, fee recipient, upgrade authority, token registry operator, and monitoring operator. Key compromise is listed as a critical threat (§28.3). This ADR defines how signing authority is managed.

## Decision drivers

- Single key compromise must not compromise the entire protocol
- Emergency pause must be fast (low threshold)
- High-impact changes (upgrades, fee changes) must have higher thresholds and timelocks
- No shared personal keys or seed phrases in env files (§35)
- Must work across EVM (EOA/multisig) and Solana (multisig/Squads)

## Options considered

### Option A: Individual EOA/keypair per role
**Cons:** Single point of failure per role. Key loss = permanent loss of authority.

### Option B: Multisig for all sensitive roles
**Pros:** No single point of failure. **Cons:** Pause speed may suffer.

### Option C: Multisig + timelock for high-impact; lower threshold for emergency (Recommended)
**Pros:** Balances security with operational speed. Emergency pause is fast (1-of-N or 2-of-N). Config changes have timelock (e.g., 24-48h). Upgrade authority requires higher threshold (e.g., 3-of-5).

## Decision

**Recommended: Option C** — Tiered signing model:

| Role | EVM | Solana | Threshold | Timelock |
|------|-----|--------|-----------|----------|
| Deployer | Multisig (Safe) | Multisig (Squads) | 2-of-3 | None |
| Protocol Admin | Multisig | Multisig | 3-of-5 | 48h for config changes |
| Guardian/Pause | Multisig | Multisig | 1-of-3 | None (emergency) |
| Fee Recipient | Multisig | Multisig | 2-of-3 | None |
| Upgrade Authority | Multisig | Multisig | 3-of-5 | 72h timelock |
| Token Registry Operator | Multisig | Multisig | 2-of-3 | None |
| Monitoring Operator | Individual (read-only) | Individual (read-only) | N/A | N/A |

Exact signer counts are placeholders — adjust based on team size.

## Security implications

- Guardian/pause at 1-of-3 allows fast emergency response but requires monitoring for abuse
- Timelock for upgrades gives community/team time to review changes
- All role changes must be logged and monitored (§33 security-facing metrics)
- Key rotation and recovery procedures must be documented and tested

## Economic implications

- Multisig transactions have higher gas cost on EVM
- Squads multisig transactions have higher compute cost on Solana

## Operational implications

- Team must maintain signer availability for all threshold operations
- Recovery procedures must be tested in non-production environment
- Role changes must follow change management process

## Alternatives rejected

- Option A: Unacceptable single-point-of-failure risk for a DeFi protocol
- Option B: Emergency pause may be too slow with full multisig threshold

## Open questions

- Exact number of signers per role (depends on team size)
- Hardware wallet requirement for signers?
- Key rotation schedule

