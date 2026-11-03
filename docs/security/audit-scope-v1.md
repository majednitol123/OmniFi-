# OmniFi Protocol — Audit Scope & Formal Code Freeze Specification
**Document Version:** 1.1.0  
**Audit Target:** Release 1.0.0 Core Protocol Candidate  
**Date:** 2026-11-03  
**Classification:** Independent Security Auditor Baseline & Handoff Scope  
**Pinned Git Tree Hash:** `a30882c8ae2d3d76018c429028e811634119e336` (Post-Remediation Baseline)  

---

## 1. Executive Summary & Audit Mandate

This document establishes the authoritative code freeze, repository boundary, multi-chain threat surface definition, and formal handoff criteria for the independent third-party security audit of the OmniFi Decentralized Exchange (DEX).

OmniFi provides non-custodial decentralized exchange functionality across Ethereum Mainnet (`eip155:1`), Base (`eip155:8453`), and Solana (`solana:mainnet-beta`). The protocol implements constant-product AMM mechanics, concentrated-liquidity market maker (CLMM) math, singleton flash-accounting (V4), decoupled transaction preparation, and reorg-resilient off-chain data services.

> [!IMPORTANT]
> **Independent Audit Requirement (Gate D):** While internal security reviews and formal invariant fuzzing have verified all core invariants (see `docs/security/audit-reports/`), mainnet deployment requires a formal, independent external security audit conducted by top-tier Web3 security auditing firms (e.g., Trail of Bits, OpenZeppelin, Zellic, OtterSec, Neodyme). No smart contract, program, or routing logic may be altered within the frozen tree hashes without an official, tracked audit addendum and independent auditor sign-off.

---

## 2. Pinned Cryptographic Tree Hashes (Code Freeze Baseline)

The audit evaluates the repository in strict accordance with the following Git tree hashes at remediated candidate baseline tree `a30882c8ae2d3d76018c429028e811634119e336`:

| Scope Boundary | Subdirectory Path | Git Tree Hash | Lines of Code (SLoC) |
|---|---|---|---|
| **EVM Smart Contracts** | `chains/evm/src/` | `93395b41bc3e3bbe5ccc43df67bc8bb8174fa5f5` | ~4,910 Solidity |
| **Solana Anchor Programs** | `chains/solana/programs/` | `7f29cd01ca18f2b9db644eb954bace8cc786fc7b` | ~3,918 Rust |
| **Core Libraries & SDKs** | `packages/` | `7773dbb807f97832ada00ff3080a578a1c117283` | ~13,981 TypeScript |
| **Backend Daemons & Indexers** | `services/` | `ac7b36c9bf5c5a5db989b26aa7522c867aea41f9` | ~6,615 TypeScript |

---

## 3. In-Scope Components & Source Manifest

### 3.1 EVM Smart Contracts (`chains/evm/src/`)
1. **Constant Product V2 Core (`v2/`)**:
   - `OmniFiV2Factory.sol`: Deterministic pair deployment via `CREATE2`, protocol fee fraction governance, pair indexing.
   - `OmniFiV2Pair.sol`: Invariant enforcement ($k \ge r_0 \cdot r_1$), cumulative price oracles (TWAP), flash-mint protections, protocol fee distribution.
   - `libraries/OmniFiV2Library.sol`: Reentrancy-safe routing math, `getAmountOut`, `getAmountIn`, square-root reserves.
2. **Concentrated Liquidity CLMM Core (`clmm/`)**:
   - `OmniFiPoolFactory.sol`: Dynamic pool deployment, fee tier authorization (500, 3000, 10000 bps), tick spacing mapping.
   - `OmniFiPool.sol`: Virtual reserve math, discrete tick crossing, position tracking, protocol fee extraction.
   - `OmniFiSwapRouter.sol`: Single-hop and multi-hop exact-input and exact-output trade routing with slippage protection.
   - `libraries/SqrtPriceMath.sol`, `TickMath.sol`, `FullMath.sol`, `TickBitmap.sol`: Fixed-point Q64.96 arithmetic, phantom overflow prevention.
3. **Singleton Pool Manager (`v4/`)**:
   - `OmniFiPoolManager.sol`: Centralized liquidity singleton, transient flash accounting delta settling, hook authorization.

### 3.2 Solana Programs (`chains/solana/programs/`)
1. **Constant Product AMM (`omnifi_amm/`)**:
   - `src/lib.rs`: Pool state initialization, PDA authority derivation, swap exact input/output, LP deposit/withdrawal.
   - Fixed-point u128 arithmetic, constant product conservation, protocol fee truncation.
2. **Concentrated Liquidity CLMM (`omnifi_clmm/`)**:
   - `src/lib.rs`: Discrete tick array indexing, bitmap traversal, position minting, fee growth outside tracking.
   - `src/math/*`: `tick_math.rs`, `sqrt_price_math.rs`, `full_math.rs`.

### 3.3 Core Off-Chain Packages (`packages/`)
- `@omnifi/domain`: Canonical asset identifiers (CAIP-19), amount typing, error taxonomy.
- `@omnifi/quote-engine`: Dijkstra multi-hop route discovery, split-routing math, execution price simulation.
- `@omnifi/rpc-resilience`: Circuit breaker state machine, exponential backoff with jitter, automated endpoint failover.
- `@omnifi/sdk-evm`, `@omnifi/sdk-solana`, `@omnifi/sdk-unified`: Decoupled transaction serialization and unsigned payload construction.

---

## 4. Out-of-Scope Boundaries

The following components are explicitly outside the core protocol audit boundary:
1. **External ERC20 / SPL Token Contracts**: Non-standard tokens (e.g. rebasing tokens, fee-on-transfer tokens, pausable/blacklisting tokens) are handled via explicit exclusion or verified risk tiers.
2. **Third-Party RPC Node Infrastructure**: Alchemy, Infura, QuickNode, and Helius node internal consensus mechanisms are untrusted external networks mitigated by `@omnifi/rpc-resilience`.
3. **Browser Wallet Extensions**: MetaMask, Phantom, and Solflare client-side key generation and signature displays.
4. **Third-Party Cloud Providers**: AWS, Cloudflare, and Docker host operating systems.

---

## 5. Security Model & Primary Threat Vectors

Auditors must specifically evaluate the protocol against the following threat vectors:

1. **Economic Invariant Violations**:
   - Any sequence of deposits, swaps, or fee claims that causes pool reserves to decrease beyond the mathematical invariant.
   - Dust round-trip arbitrage draining token balances over repeated cycles.
2. **Flash Accounting Delta Non-Settlement (V4 Singleton)**:
   - Any exploit path allowing a caller to take transient token balances without settling all negative deltas before transaction completion.
3. **Cross-Program Invocation (CPI) & PDA Spoofing (Solana)**:
   - Supplying forged account PDAs, unverified vault tokens, or unverified mint accounts to AMM/CLMM instructions.
   - Bypassing signer or writable account verification.
4. **Frontrunning & Sandwich Attacks**:
   - Manipulation of transaction ordering to extract value when users trade with wide slippage limits.
5. **Reentrancy & Callback Vulnerabilities**:
   - External calls during ERC20 transfers (e.g. ERC777 tokens or hook callbacks) attempting to re-enter pools before state update.
6. **Key Custody & Signature Forgery**:
   - Ensuring backend APIs NEVER accept, store, or sign with user private keys (ADR-011).

---

## 6. Build & Toolchain Specifications

To ensure exact cryptographic reproducibility, builds must use:
- **EVM Compiler**: Solidity `0.8.26`, Optimizer: `true` (200 runs), EVM Version: `cancun`.
- **Foundry Framework**: `forge v1.4.4` (pinned in CI).
- **Rust Toolchain**: `rustc 1.89.0`, Anchor CLI: `0.32.1`, Solana CLI: `1.18.26`.
- **Node & Package Manager**: Node.js `v20.x`, PNPM `v9.15.4`.

---

## 7. Audit Scope Addendum — Remediation Baseline (Post-Audit Fixes)

Following comprehensive internal security and architectural audits, 57 files were modified to resolve all 14 identified findings (F-01 through F-14) and establish the clean pre-audit candidate:

| Finding Ref | Vulnerability Summary | Remediated Files | Verification Suite |
|---|---|---|---|
| **F-01 / Gate E** | False mainnet deployment claims & error-swallowing verification scripts | `deployments/production/*.json`, `scripts/verify-*.sh` | `verify-deployment-hashes.sh`, `verify-roles-and-signers.sh` |
| **F-02 / P0** | Flash accounting delta non-settlement & multi-caller locker confusion | `chains/evm/src/v4-core/OmniFiPoolManager.sol`, `TransientStorage.sol` | `FlashAccounting.t.sol`, `V4Invariant.t.sol` |
| **F-03 / P0** | Incomplete transaction preparation calldata & Solana accounts | `services/quote-api/src/routes/prepare.ts`, `@omnifi/sdk-*` | `api.test.ts`, live `curl` integration tests |
| **F-04 / P0** | Synthetic client-side timer finality and pseudo-random tx hashes | `@omnifi/sdk-unified`, `@omnifi/sdk-evm` | EIP-1193 receipt polling & Solana signature tests |
| **F-05 / P1** | Solana AMM fee deduction reserve desynchronization | `chains/solana/programs/omnifi_amm/src/instructions/swap.rs` | `cargo test`, `integration.test.ts` |
| **F-06 / P1** | Solana CLMM exact-output swap tick array exhaustion assertion | `chains/solana/programs/omnifi_clmm/src/instructions/swap.rs` | `cargo test`, `integration.test.ts` |
| **F-07 / P1** | SSRF vulnerability allowing arbitrary cloud metadata/private probing | `services/quote-api/src/routes/simulate.ts` | `api.test.ts`, live `curl` SSRF rejection tests |
| **F-08 / P1** | Hardcoded mock logs and fabricated simulation success guarantees | `packages/quote-engine/src/simulation/*`, `simulate.ts` | Live RPC simulation with custom revert decoding |
| **F-09 / P1** | EVM multi-hop CLMM path byte packing (`encodePacked`) | `packages/quote-engine/src/simulation/evm-intent-builder.ts` | `quote-engine` multi-hop unit tests |
| **F-10 / P1** | IEEE 754 floating-point precision loss in quote calculations | `packages/quote-engine/src/quotes/quote-calculator.ts`, `split-router.ts` | Clamped pure BigInt quote calculator unit tests |
| **F-11 / P1** | Solana log decoder synthetic trade fallbacks | `services/indexer-solana/src/log-decoder.ts`, `scanner.ts` | Anchor Borsh event deserialization unit tests |
| **F-12 / P1** | Solana Token-2022 fee-on-transfer incompatibility risks | `docs/security/token-compatibility.md` | Token whitelist policy & SPL account verification |
| **F-13 / P1** | Requirements traceability matrix dangling links | `docs/requirements-traceability.csv` | Automated markdown reference audit |
| **F-14 / P1** | CI security workflow error swallowing (`\|\| true`) | `.github/workflows/security.yml` | Strict fail-closed security workflow |

---

## 8. Independent Third-Party External Audit Engagement Specification (Release Gate D)

### 8.1 Qualified External Auditor Profile
To satisfy mandatory **Release Gate D**, OmniFi must engage one or more accredited independent Web3 security auditing firms possessing verifiable expertise in both EVM Cancun singleton architectures and Solana Anchor CLMM math:
- **EVM Specialty Tier:** Trail of Bits, OpenZeppelin, Spearbit, Consensys Diligence, Zellic.
- **Solana Specialty Tier:** Neodyme, OtterSec, Zellic, Sec3, Kudelski Security.

### 8.2 Scope of Work & Verification Deliverables
The external audit engagement covers the full frozen tree `a30882c8ae2d3d76018c429028e811634119e336`:
1. **Whitebox Smart Contract & Program Audit:** Review of all in-scope Solidity contracts and Rust Anchor programs for logical flaws, reentrancy, access control, integer safety, and cross-contract calling semantics.
2. **Economic Invariant & AMM Math Review:** Mathematical validation of virtual reserve conservation, Discrete Q64.96 tick crossing formulas, fee growth tracking outside ticks, and anti-sandwiching slippage protections.
3. **Formal Verification of Singleton Lock Accounting:** Automated SMT/model checking confirming that the V4 Pool Manager transient storage guarantees zero non-settled currency deltas across arbitrary callback reentrancy graphs.
4. **Off-Chain Infrastructure & Decoupled Key Management (ADR-011):** Validation that the Quote API, Transaction Preparation engine, and Indexers maintain non-custodial boundaries with zero private key handling.

### 8.3 Audit Handoff Artifact Bundle
External auditors are provided with:
- **Audit Package:** `docs/security/audit-package-v1.0.0.json` containing cryptographic tree digests and toolchain specs.
- **Reproducible Build Environment:** Pinned Docker container (`Dockerfile.dev`, `docker-compose.yml`) ensuring deterministic builds matching pinned toolchains.
- **Automated Verification Harness:** 155 Forge tests, 30 Solana Anchor tests, and 32 Turbo monorepo test tasks.
- **Threat Models:** `docs/security/threat-model-evm.md` and `docs/security/threat-model-solana.md`.

### 8.4 Independent Audit Sign-Off Gate (Gate D Acceptance Criteria)
Mainnet release authorization will be granted ONLY when:
1. The independent audit firm issues an official, signed audit report against the frozen Git tree.
2. Zero **CRITICAL** or **HIGH** severity findings remain unaddressed.
3. All **MEDIUM** and **LOW** severity findings are either remediated with auditor re-test sign-off or documented in `docs/security/residual-risk-register.md` with explicit protocol owner acceptance.
4. A formal public audit release certificate is issued and referenced in the final Release Authorization.
