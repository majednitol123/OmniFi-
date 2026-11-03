# OmniFi Protocol — Consolidated Audit Finding Register
**Version:** 1.0.0  
**Status:** ALL FINDINGS REMEDIATED & VERIFIED  
**Audit Period:** Release 1.0.0 Audit  
**Date:** 2026-11-01  

---

## 1. Finding Overview & Severity Taxonomy

Findings are classified in accordance with the Common Vulnerability Scoring System (CVSS v3.1) and categorized by severity:
- **CRITICAL**: Vulnerability allowing direct loss of user funds, unbounded minting, or irreversible state freeze.
- **HIGH**: Vulnerability permitting conditional drain of funds or temporary disruption of core protocol invariants.
- **MEDIUM**: Suboptimal design, elevated griefing risk, or potential precision degradation under boundary conditions.
- **LOW**: Minor inconsistency, configuration edge case, or informational improvement.
- **INFORMATIONAL**: Best practice recommendation, documentation clarification, or code hygiene.

---

## 2. Master Finding Register

| Finding ID | Component | Title | Severity | CVSS v3.1 | Status | Remediation PR / Commit | Verified By |
|---|---|---|---|---|---|---|---|
| **F-01** | `deployments/`, `scripts/` | False Mainnet Claims & Error Swallowing (`\|\| true`) in Verification Scripts | **Critical** | 9.1 | **RESOLVED** | Phase 13 Hardening | SRE & Security Lead |
| **F-02** | `OmniFiPoolManager.sol` | V4 Flash Accounting Multi-Caller Delta Confusion & Reentrancy | **Critical** | 9.8 | **RESOLVED** | Phase 5 Remediation | Core Protocol |
| **F-03** | `prepare.ts` | Truncated Calldata & Missing Solana Account Metas in Prepare API | **Critical** | 9.0 | **RESOLVED** | Phase 10 Remediation | Core Security |
| **F-04** | `tx-executor.ts` | Synthetic Client-Side Timer Finality & Pseudo-Random Tx Hash Fabrication | **Critical** | 8.9 | **RESOLVED** | Phase 12 Remediation | Frontend & Core |
| **F-05** | `omnifi_amm/swap.rs` | Solana AMM Protocol Fee Reserve Deduction Desynchronization | **High** | 7.5 | **RESOLVED** | Phase 7 Remediation | Solana Core |
| **F-06** | `omnifi_clmm/swap.rs` | Solana CLMM Exact-Output Swaps Allowed Incomplete Output Without Assertion | **High** | 7.5 | **RESOLVED** | Phase 8 Remediation | Solana Core |
| **F-07** | `simulate.ts` | SSRF Primitive via Caller-Supplied RPC Permitting Cloud Metadata Probing | **High** | 8.6 | **RESOLVED** | Phase 9 Remediation | AppSec Lead |
| **F-08** | `simulate.ts` | Solana Simulation Used Fabricated Mock Logs with Phantom Success Guarantees | **High** | 7.2 | **RESOLVED** | Phase 9 Remediation | Core Protocol |
| **F-09** | `evm-intent-builder.ts` | EVM Multi-Hop CLMM Path Missing Tightly-Packed (`encodePacked`) Bytes | **High** | 7.1 | **RESOLVED** | Phase 9 Remediation | EVM Core |
| **F-10** | `quote-calculator.ts` | Quote Calculator & Split Router Used Float Math Causing Precision Loss | **High** | 7.4 | **RESOLVED** | Phase 9 Remediation | Quant & Core |
| **F-11** | `log-decoder.ts` | Solana Indexer Decoded Mock Trades with Hardcoded Fallback Balances | **High** | 7.5 | **RESOLVED** | Phase 11 Remediation | Data Platform |
| **F-12** | `token-compatibility.md`| Token-2022 Transfer Fee Compatibility Lacked Explicit Architecture Boundary | **High** | 7.0 | **RESOLVED** | Phase 0 Remediation | Security Team |
| **F-13** | `traceability.csv` | Requirements Traceability Contained 51 Dead Links & Fictitious Files | **High** | 7.0 | **RESOLVED** | Phase 1 Remediation | QA Lead |
| **F-14** | `security.yml` | Security CI Swallowed Audit Failures via `\|\| true` | **High** | 7.3 | **RESOLVED** | Phase 2 Remediation | DevSecOps Lead |
| **OMNI-SEC-01** | `prepare.ts` | Solana Transaction Preparation Used Placeholder Data | **Medium** | 5.3 | **RESOLVED** | Phase 10 Remediation | Core Security |
| **OMNI-SEC-02** | `positions.ts` | Positions Endpoint Used Hardcoded Projection & Mock Payload | **Medium** | 4.8 | **RESOLVED** | Phase 10 Remediation | Core Security |
| **OMNI-SEC-03** | `analytics.ts` | Analytics Endpoint Returned Hardcoded Global Strings | **Low** | 3.1 | **RESOLVED** | Phase 10 Remediation | Core Security |
| **OMNI-SEC-04** | `OmniFiV2Invariant.t.sol` | Fuzz Handler Reverted When Reserves Depleted Below 1000 | **Low** | 2.5 | **RESOLVED** | Phase 4 Remediation | Core Protocol |
| **OMNI-SEC-05** | `OmniFiV2Factory.sol` | Protocol Fee Fraction Lacked Hard Governance Upper Cap | **Medium** | 5.0 | **RESOLVED** | Phase 6 Remediation | Core Protocol |
| **OMNI-SEC-06** | `OmniFiSwapRouter.sol` | Multi-Hop Exact Output Lacked Explicit Slippage Cap | **Low** | 3.3 | **RESOLVED** | Phase 8 Remediation | Core Protocol |
| **OMNI-SEC-07** | `omnifi_clmm` | Discrete Tick Array Space Allocation Lacked Rent Exemption Bounds | **Low** | 3.0 | **RESOLVED** | Phase 9 Remediation | Solana Core |
| **OMNI-SEC-08** | `rpc-resilience` | Single RPC Provider Failure Stalled In-Flight Transactions | **Medium** | 5.8 | **RESOLVED** | Phase 12 Remediation | SRE Team |
| **OMNI-SEC-09** | `WalletContext.tsx` | EVM / Solana Network Mismatch Allowed Blind Signing | **Low** | 3.7 | **RESOLVED** | Phase 12 Remediation | Frontend Lead |
| **OMNI-SEC-10** | `metrics.ts` | Prometheus Metrics Exposed Global State Without Reset | **Informational** | N/A | **RESOLVED** | Phase 13 Remediation | SRE Team |
| **SCAN-01** | `OmniFiSwapRouter.sol` | Ether Locked in Router Functions Without Withdrawal or Sweep | **Medium** | 6.5 | **RESOLVED** | Phase 6 Remediation | AppSec & Protocol |
| **SCAN-02** | `OmniFiPool.sol`, `Pool.sol`, `OmniFiPositionManager.sol` | Raw Downcasting of uint256 to uint128 Truncates Silently on Overflow | **Medium** | 5.3 | **RESOLVED** | Phase 6 Remediation | Core Protocol |
| **SCAN-03** | `services/quote-api/Dockerfile` | Trivy DS-0002: Container Process Runs as Root | **Medium** | 5.3 | **RESOLVED** | Phase 6 Remediation | DevSecOps Lead |
| **SCAN-04** | `omnifi_clmm/src/lib.rs` | Clippy Warning: Redundant Assertions on Compile-Time Constants | **Low** | 2.0 | **RESOLVED** | Phase 6 Remediation | Solana Core |
| **SCAN-05** | `OmniFiPoolManager.sol` | Slither Warning: State Variable `protocolFeeController` Missing Immutable Qualifier | **Informational** | N/A | **RESOLVED** | Phase 6 Remediation | Core Protocol |

---

## 3. Remediation Details & Verification Evidence

### OMNI-SEC-01: Solana Transaction Preparation Payload Remediation
- **Issue**: `services/quote-api/src/routes/prepare.ts` returned `'swap_mock_payload'` instead of serialized binary Solana Anchor instruction data.
- **Remediation**: Replaced string placeholder with genuine binary buffer construction using `buildAmmSwapIx` from `@omnifi/sdk-solana`. Encodes the 8-byte Anchor instruction discriminator (`swap_exact_input`), `amountIn`, `minimumAmountOut`, and `zeroForOne`, and returns base64-encoded instruction data with derived PDAs.
- **Verification**: Verified via `api.test.ts` and automated preparation assertions.

### OMNI-SEC-02: Position Fee Harvest Calldata Remediation
- **Issue**: `services/quote-api/src/routes/positions.ts` returned hardcoded mock data and `'collect_fees_mock_payload'`.
- **Remediation**: Implemented dynamic position querying against pool instances and encoded real `collect(CollectParams)` calldata using `encodeFunctionData` with `CLMM_POSITION_MANAGER_ABI` from `@omnifi/sdk-evm`.
- **Verification**: Tested with real address and ABI encoding tests.

### OMNI-SEC-03: Real Graph-Derived Dynamic Analytics
- **Issue**: `services/quote-api/src/routes/analytics.ts` returned static numbers (`totalTvlUsd: '150000000'`).
- **Remediation**: Wired `PoolGraph` instance to dynamically calculate TVL from actual pool reserves (`reserve0`, `reserve1`) and compute real 24h volume and swap counts.
- **Verification**: Verified via `/api/v1/analytics/overview` and pool analytics tests.

### SCAN-01: Native Ether Rejection & Administrative Sweep in OmniFiSwapRouter
- **Issue**: `exactInputSingle`, `exactInput`, `exactOutputSingle`, and `exactOutput` were payable but did not support native ETH wrapping or refunds, permanently locking any Ether sent by callers.
- **Remediation**: Added `if (msg.value > 0) revert NativeEtherNotAccepted();` to all swap entrypoints. Implemented `sweepToken` and `refundETH` administrative recovery functions in `OmniFiSwapRouter.sol` with `TransferHelper.safeTransferETH`.
- **Verification**: Verified via regression tests `test_SwapRouter_RevertsOnNativeEtherSent()`, `test_SwapRouter_SweepToken()`, and `test_SwapRouter_RefundETH()` in `SecurityRegression.t.sol`. Aderyn H-1 eliminated.

### SCAN-02: SafeCast Enforcement on Integer Downcasting
- **Issue**: Raw `uint128(...)` casts in `OmniFiPool.sol`, `Pool.sol`, and `OmniFiPositionManager.sol` truncated high bits silently on numeric overflow.
- **Remediation**: Replaced all raw downcasts with `SafeCast.toUint128(...)`. Added custom error `InvalidProtocolFeeFraction()` in `OmniFiPool.sol`.
- **Verification**: Verified via `test_SafeCast_Uint128_Overflow_Reverts()` and `test_OmniFiPool_SetProtocolFeeFraction_CustomError()` in `SecurityRegression.t.sol`. Aderyn H-3 eliminated.

### SCAN-03: Non-Root Execution in Container Dockerfile
- **Issue**: `services/quote-api/Dockerfile` ran application processes as `root` (Trivy `DS-0002`).
- **Remediation**: Added `USER node` directive before `CMD`.
- **Verification**: Verified via `trivy config services/quote-api/Dockerfile` (0 misconfigurations detected).

### SCAN-04: Compile-Time Constant Assertions Refactoring
- **Issue**: `assert!(MIN_SQRT_PRICE > 0)` and `assert!(MAX_SQRT_PRICE > MIN_SQRT_PRICE)` in `omnifi_clmm` tests triggered Clippy `clippy::assertions_on_constants`.
- **Remediation**: Replaced static constant assertions with dynamic evaluations validating that `get_sqrt_price_at_tick` at MIN/MAX tick bounds matches the constant price bounds.
- **Verification**: Verified via `cargo clippy --all-targets` (0 warnings).

### SCAN-05: Immutable Fee Controller in V4 Singleton
- **Issue**: Slither flagged `protocolFeeController` in `OmniFiPoolManager.sol` as non-immutable despite being immutable by design.
- **Remediation**: Declared `address public immutable protocolFeeController;`.
- **Verification**: Verified via Slither analysis (detector clear) and all V4 invariant test suites.

---

## 4. Retest Sign-Off
All 14 initial manual audit findings (F-01 through F-14), 10 protocol security findings (OMNI-SEC-01 through OMNI-SEC-10), and 5 automated scan findings (SCAN-01 through SCAN-05) have been thoroughly remediated, covered by automated regression test suites, and signed off as **RESOLVED**. No critical or high vulnerabilities remain open.
