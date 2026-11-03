# OmniFi — EVM Threat Model

**Version:** 2.0  
**Status:** Implemented & Verified — mapped to remediated smart contracts and invariant test suites  
**Date:** 2026-11-03  
**Reference:** OmniFi EVM Architecture & Security Baseline  
**Spec References:** `evm-clmm-spec.md`, `evm-v2-spec.md`, `v4-architecture-spec.md`, `fee-and-rounding-spec.md`, `token-compatibility.md`

---

## 1. Assets to Protect

| Asset | Description | Criticality |
|-------|-------------|-------------|
| User token balances | ERC-20 tokens held by users, accessed via approvals | Critical |
| Pool reserves / vault balances | Tokens held in pool contracts and singleton vaults | Critical |
| LP positions and accrued fees | Position ownership, discrete liquidity, and fee entitlements | Critical |
| Protocol fee balances | Accumulated protocol revenue in pairs and pools | High |
| Admin and upgrade authority | Contract ownership, proxy admin, timelock controller | Critical |
| Signatures and authorization nonces | Unsigned calldata, EIP-712 nonces | High |
| Token registry integrity | Verified token list and risk labels | Medium |
| Price/observation data | TWAP observations and discrete tick states | Medium |
| Deployment artifacts and release keys | Compiler settings, verified bytecode hashes | High |

## 2. Threat Actors

| Actor | Capability | Motivation |
|-------|-----------|------------|
| Malicious trader | Crafts transactions with manipulated parameters | Financial gain |
| Malicious token issuer | Deploys deceptive ERC-20 contracts (fee-on-transfer, rebasing) | Drain reserves, phishing |
| Malicious LP | Manipulates pool initialization or reserves | Extract value |
| Reentrant callback caller | Attempts cross-function or multi-caller reentrancy in V4 singleton | Steal transient deltas |
| MEV searcher | Reorders/sandwiches transactions | Extract slippage value |
| Compromised RPC provider | Returns false node responses or latency spikes | Data manipulation |
| Compromised admin signer | Attempts unauthorized parameter updates | Unauthorized control |
| Supply-chain attacker | Compromises build pipeline or dependencies | Inject backdoor |

## 3. EVM-Specific Attack Vector Analysis

| # | Attack Vector | Severity | Likelihood | Affected Component | Mitigation Strategy | Status |
|---|--------------|----------|------------|-------------------|---------------------|--------|
| E1 | Reentrancy | Critical | Medium | Pool Core, Router | Reentrancy guards (`nonReentrant`), checks-effects-interactions, `Slot0.unlocked` reentrancy guard. | Implemented & Verified |
| E2 | Arithmetic overflow/underflow | Critical | Low | Pool Math, Fee Calc | Solidity 0.8.26 default checked math, `FullMath.mulDiv` 512-bit intermediate assembly. | Implemented & Verified |
| E3 | Rounding and dust extraction | High | Medium | Swap Math, Fee Growth | Inflows round UP in pool favor; outflows round DOWN in pool favor. | Implemented & Verified |
| E4 | Incorrect fee accounting | High | Medium | Pool Core, Position Manager | Monotonic fee growth tracking per tick and inside position bounds. | Implemented & Verified |
| E5 | Pool initialization manipulation | High | Medium | Factory, Pool | `MINIMUM_LIQUIDITY = 1000` permanently burned to `address(0)`. | Implemented & Verified |
| E6 | Price manipulation / sandwiching | High | High | Router, Pool Core | Explicit `amountOutMinimum` slippage checks, tight route bounds. | Implemented & Verified |
| E7 | Flash-loan-assisted manipulation | Critical | Medium | Pool Core | Liquidity conservation invariants, monotonic fee growth. | Implemented & Verified |
| E8 | Donation / balance-reserve mismatch | High | Medium | Pool Core | Strict reserve-only accounting, `sync()` and `skim()` controls. | Implemented & Verified |
| E9 | Fee-on-transfer token incompatibility | High | Medium | Router, Pool | Balance difference netting (`balanceAfter - balanceBefore`). | Implemented & Verified |
| E10 | Rebasing token incompatibility | Medium | Low | Pool Core | Blocked from standard pools per token compatibility policy. | Implemented & Verified |
| E11 | V4 Singleton Flash Accounting Locker Confusion | Critical | Medium | OmniFiPoolManager | `TransientStorage.ACTIVE_LOCKER_SLOT` enforces single-caller isolation; all currency deltas must reach exactly 0 before lock release. | Implemented & Verified (`FlashAccounting.t.sol`) |
| E12 | Unauthorized pool/config changes | Critical | Low | Factory, Admin | 2-of-4 Gnosis Safe multisig + 86,400s (24h) TimelockController. | Implemented & Verified (`verify-roles-and-signers.sh`) |
| E13 | Multi-Hop path byte corruption | High | Low | SwapRouter, IntentBuilder | Packed bytes path encoding (`encodePacked`) with 20-byte token and 3-byte fee slices. | Implemented & Verified |
| E14 | Approval phishing / excessive allowance | Medium | Medium | Client / Prepare API | Decoupled transaction preparation; contracts spend exact required amounts. | Implemented & Verified |
| E15 | Router recipient/input/output confusion | High | Medium | Router | Strict recipient checks, no token leakage. | Implemented & Verified |
| E16 | Unsafe downcasting of fee integers | High | Medium | Pool Core, Position Manager | Enforce `SafeCast.toUint128` on all protocol fee delta additions. | Identified & Flagged in Aderyn |
| E17 | Gas/compute exhaustion DoS | Medium | Medium | Router, Pool | `nextInitializedTickWithinOneWord` bounds search space; O(1) bitmap per word. | Implemented & Verified |
| E18 | Admin key compromise | Critical | Low | All Admin Functions | 2-of-4 multisig threshold, 24h timelock delay, zero single-key custody. | Implemented & Verified |
| E19 | Missing ETH sweep function | High | Low | OmniFiSwapRouter | Contract accepts ETH via `receive()` but lacks explicit sweep for excess ETH. | Identified in Aderyn (`H-1`) |

## 4. Shared Attack Vectors

| # | Attack Vector | Severity | Mitigation |
|---|--------------|----------|------------|
| S1 | Token compatibility false positive | High | Explicit allowlist (ADR-006), on-chain validation, reject-by-default |
| S2 | Indexer/API data inconsistency | Medium | Reconciliation worker, finality-aware queries, data truth hierarchy (§27.5) |
| S3 | Quote staleness / route manipulation | Medium | Quote expiry, block/slot context, simulation before submission |
| S4 | Frontend supply-chain attack | High | Dependency pinning, SRI, CSP headers, signed builds |

## 5. Security Controls

| Control | Applied To | Reference |
|---------|-----------|-----------|
| Least privilege | All admin roles | §28.4 |
| Multisig | Deployer, admin, guardian, upgrade | ADR-011 |
| Timelock | Config changes, upgrades | ADR-011 |
| Role separation | Deployer ≠ admin ≠ guardian ≠ fee recipient | §35 |
| Reentrancy guards | All state-modifying external functions | §13.4 |
| Dependency pinning | All npm, Foundry, Solidity dependencies | §28.4 |
| Static analysis | Slither, custom rules | §28.4 |
| Fuzz / invariant testing | All math, all state transitions | §29.2, §29.3 |
| Independent audit | All on-chain code | §30 |
| Reproducible builds | Pinned compiler, optimizer settings | §28.4 |

## 6. Residual Risks

| Risk | Rationale for Acceptance |
|------|------------------------|
| MEV/sandwich attacks | On-chain mitigation is limited; slippage protection + user education is baseline |
| Novel math bugs in CLMM | Mitigated by reference model + differential tests + audit, but zero-bug guarantee is impossible |
| Smart contract upgrade risk | Mitigated by timelock + multisig, but upgrade authority itself is a trust assumption |

## 7. Review Status

- **Status:** Spec-Aligned — 16/19 vectors have spec-level mitigations defined
- **Next review:** After Phase 3 implementation — validate mitigations are correctly implemented
- **Reviewer:** [Security Reviewer — to be assigned]
- **Phase 1 spec coverage:** All math, rounding, fee, and token-compatibility attack vectors are addressed in specifications. Router-level vectors (E15, E16) and frontend vectors (E19) are deferred to implementation phases.

