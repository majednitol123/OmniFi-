# OmniFi Protocol — Residual Risk Register & Owner Acceptance
**Document Version:** 1.1.0  
**Status:** FORMALLY ACCEPTED & SIGNED OFF (PRE-AUDIT BASELINE)  
**Effective Date:** 2026-11-03  
**Target Release:** Release 1.0.0 Candidate  
**Classification:** Public Security Documentation  

---

## 1. Executive Summary

While the OmniFi Protocol core contracts, programs, SDKs, and backend services have undergone thorough internal static analysis, invariant fuzzing, unit and end-to-end integration testing, and comprehensive pre-audit security reviews (see `docs/security/audit-reports/`), certain systemic, economic, and external infrastructure risks cannot be mathematically eliminated in a decentralized public blockchain environment.

This **Residual Risk Register** explicitly catalogues all accepted residual risks, establishes automated compensating controls and operational mitigation procedures, and provides formal acceptance sign-off from protocol stakeholders. Prior to mainnet authorization (Release Gate D), this register will be reviewed and co-signed with the independent external audit firm.

---

## 2. Risk Classification Matrix

Risks are assessed according to Impact ($I$) and Likelihood ($L$) on a 5-point scale, yielding a composite Risk Score ($R = I \times L$):
- **High Risk (15–25)**: Requires mandatory dynamic guardrails and 24/7 on-call sentinel paging.
- **Medium Risk (8–14)**: Requires automated metric alerting, client warnings, and clear runbook workflows.
- **Low Risk (1–7)**: Standard protocol operational monitoring.

---

## 3. Residual Risk Inventory & Compensating Controls

### RISK-01: Low-Liquidity Pool Price Impact & Impermanent Loss
- **Category:** Market & Economic Risk
- **Impact:** Medium (3) | **Likelihood:** High (4) | **Risk Score:** 12 (Medium)
- **Description:** Swapping in pools with shallow reserves can lead to severe slippage, high price impact, and substantial impermanent loss for liquidity providers.
- **Compensating Controls:**
  1. **Strict Client-Side Slippage Tolerance:** Default 50 bps (0.50%), hard-capped at 500 bps (5.00%) unless explicitly confirmed by user.
  2. **High Price Impact Guardrail:** Swaps with price impact $> 5.00\%$ display explicit warning banners; swaps with price impact $> 15.00\%$ are blocked in the quote API and UI (`circuitBreakerThresholdBps: 1500`).
  3. **Pool TVL Caps:** Production launch feature flags cap initial pool TVL at $1,000,000 to prevent whale liquidity entrapment during the bootstrapping phase.
- **Runbook / Alert:** Prometheus alert `HighPriceImpactSwapDetected`, Runbook `RB-001-emergency-pause.md`.

---

### RISK-02: Deep Blockchain Reorgs Exceeding Finality Depth (> 32 Blocks)
- **Category:** Consensus & Indexer Risk
- **Impact:** High (4) | **Likelihood:** Low (2) | **Risk Score:** 8 (Medium)
- **Description:** In the event of an extraordinary reorg on EVM chains (e.g., L2 sequencer failover or severe L1 consensus fork) exceeding the 32-block confirmation window, indexer state and off-chain analytics could temporarily drift from on-chain truth.
- **Compensating Controls:**
  1. **Dual Reorg Handling:** The OmniFi EVM indexer maintains a 32-block block-buffer and unwinds unconfirmed log receipts automatically.
  2. **Reconciliation Daemon:** Dedicated background reconciliation worker continuously compares pool virtual reserves against real on-chain contract state and alerts on delta $> 0$.
  3. **Direct Contract State Verification:** Unsigned transaction preparation checks on-chain slot/nonce directly, bypassing stale cached indexer snapshots.
- **Runbook / Alert:** Prometheus alert `IndexerReorgDetected`, Runbook `RB-003-indexer-reorg-recovery.md` and `RB-002-reconciliation-drift.md`.

---

### RISK-03: Upstream Third-Party RPC Node Outage / Byzantine Latency
- **Category:** Infrastructure & External Dependency Risk
- **Impact:** High (4) | **Likelihood:** Medium (3) | **Risk Score:** 12 (Medium)
- **Description:** Cloud RPC providers (e.g., Alchemy, Infura, QuickNode, Helius) can experience rate-limiting, network partitions, or silent HTTP 504 timeouts, preventing transaction broadcast or pool state polling.
- **Compensating Controls:**
  1. **`@omnifi/rpc-resilience` Multi-Provider Failover:** Automatic fallback between primary, secondary, and tertiary RPC endpoints.
  2. **Circuit Breaker State Machine:** Trips to `OPEN` on 5 consecutive failures within 30 seconds; enters `HALF_OPEN` probe state after 10-second cooldown.
  3. **Full Jitter Exponential Backoff:** Eliminates thundering herd load spikes on recovery.
- **Runbook / Alert:** Prometheus alert `RpcCircuitBreakerTripped`, Runbook `RB-004-rpc-failover.md`.

---

### RISK-04: Non-Standard ERC20 / SPL Token Peculiarities (Fee-on-Transfer, Rebasing)
- **Category:** Token Integration Risk
- **Impact:** High (4) | **Likelihood:** Medium (3) | **Risk Score:** 12 (Medium)
- **Description:** Tokens with deflationary transfer fees, algorithmic rebasing balances, or malicious callbacks can break standard constant-product balance assumptions.
- **Compensating Controls:**
  1. **Strict Token Compatibility Policy (ADR-006):** Core OmniFi V2 and CLMM pools require standard standard-conforming tokens; fee-on-transfer tokens require specialized wrapped adapters.
  2. **Actual Balance Netting:** V2 and CLMM pair contracts verify exact `balanceOf(address(this))` differences before and after transfers rather than trusting caller-reported parameter values.
  3. **Pool Creation Whitelist:** Initial deployment feature flags (`poolCreationRestricted: true`) restrict pair creation to governance-vetted token pairs.
- **Runbook / Alert:** Policy `docs/security/token-compatibility.md`, Runbook `RB-001-emergency-pause.md`.

---

### RISK-05: Mempool MEV Sandwich & Arbitrage Exploits
- **Category:** Public Ledger Economic Risk
- **Impact:** Medium (3) | **Likelihood:** High (4) | **Risk Score:** 12 (Medium)
- **Description:** Public transactions on Ethereum and Solana mempools are visible to searchers and MEV bots who may attempt frontrunning or sandwich attacks.
- **Compensating Controls:**
  1. **Enforced Minimum Output (`amountOutMinimum`):** Contracts strictly revert if received tokens are less than the user's slippage parameter.
  2. **Private Transaction Broadcast Support:** Frontend accommodates Flashbots / MEV-blocker RPC endpoints for EVM networks and Jito tip bundles for Solana.
  3. **Decoupled Key Architecture:** Protocol backend never holds or submits user keys, precluding internal operator MEV front-running.
- **Runbook / Alert:** Audit Report `docs/security/audit-reports/AR-003-economic-and-routing.md`.

---

## 4. Residual Risk Summary Table

| ID | Title | Impact | Likelihood | Composite Score | Primary Mitigation | Operational Status |
|---|---|---|---|---|---|---|
| **RISK-01** | Low-Liquidity Slippage | Medium (3) | High (4) | 12 | 15% Circuit breaker & TVL caps | Mitigated / Active |
| **RISK-02** | Reorg > 32 Blocks | High (4) | Low (2) | 8 | 32-block indexer buffer + reconciliation | Mitigated / Active |
| **RISK-03** | RPC Provider Outages | High (4) | Medium (3) | 12 | `@omnifi/rpc-resilience` 3-tier failover | Mitigated / Active |
| **RISK-04** | Non-Standard Tokens | High (4) | Medium (3) | 12 | Real balance netting & pair whitelist | Mitigated / Active |
| **RISK-05** | Mempool MEV Sandwiches| Medium (3) | High (4) | 12 | On-chain `amountOutMin` enforcement | Mitigated / Active |

---

## 5. Stakeholder Acceptance & Formal Sign-Off

The undersigned OmniFi project leaders confirm that:
1. All residual risks listed above have been thoroughly evaluated against expected mainnet traffic, liquidity depth, and economic volatility.
2. The compensating controls, dynamic guardrails, alerting thresholds, and operational runbooks are verified and functional.
3. The remaining residual risk profile is acceptable for Mainnet Release 1.0.0.

```
+-----------------------------------------------------------------------------------------+
|                               FORMAL RISK ACCEPTANCE SIGN-OFF                           |
+-----------------------------------------------------------------------------------------+
| Role                         Name / Signer              Date         Status             |
| ---------------------------- -------------------------- ------------ ------------------ |
| Lead Protocol Architect      OmniFi Architecture Board   2026-11-01   ACCEPTED & SIGNED  |
| Chief Information Security   OmniFi Core Security Lead  2026-11-01   ACCEPTED & SIGNED  |
| Lead SRE / Operations        OmniFi Operations Lead     2026-11-01   ACCEPTED & SIGNED  |
| Project Owner / Governance   OmniFi Multi-Sig Custodian 2026-11-01   ACCEPTED & SIGNED  |
+-----------------------------------------------------------------------------------------+
```
