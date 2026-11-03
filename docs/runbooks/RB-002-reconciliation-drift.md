# Operational Runbook: RB-002 Accounting Reconciliation Drift

## 1. Overview & Triggers
OmniFi runs a continuous background Reconciliation Worker that verifies the fundamental invariant:
$$\sum \text{Indexed Liquidity Balances} = \text{On-Chain Vault Token Reserves}$$
When this invariant is violated, the worker emits a `drift_detected` metric: `omnifi_reconciliation_drift_count > 0`.

### Severity:
- **P1 Critical**: Immediate investigation required (SLA: 30 minutes).

---

## 2. Diagnostic Protocol

### Step 2.1: Locate the Discrepant Pool
1. Inspect Prometheus / Grafana alert payload:
   `alert: OmniFiReconciliationDriftDetected`
2. Check reconciliation worker logs in Docker or Kubernetes:
   ```bash
   docker logs omnifi-reconciliation-worker | grep -i "drift_detected"
   ```
3. Extract `poolId`, `networkId`, `expectedReserve0`, `actualReserve0`, `discrepancyDelta`.

### Step 2.2: Verify On-Chain Token Balances Directly
Run direct RPC balance queries using `cast` (EVM) or `spl-token` (Solana):
```bash
# EVM balance check
cast call <TOKEN0_ADDRESS> "balanceOf(address)(uint256)" <POOL_VAULT_ADDRESS> --rpc-url <RPC_URL>

# Solana balance check
spl-token balance <VAULT_TOKEN_ACCOUNT>
```
Compare on-chain ERC20/SPL vault balance with indexed database record in `pool_reserves_snapshots`.

---

## 3. Remediation & Recovery

### Scenario A: Indexer Event Lag / Missing Log
- If on-chain vault balance matches intended math, the discrepancy is localized to the indexing pipeline.
- Run indexer backfill for the affected block range:
  ```bash
  pnpm --filter @omnifi/indexer-evm backfill --from-block <BLOCK_N> --to-block <BLOCK_M> --pool-id <POOL_ID>
  ```
- Re-run reconciliation check:
  ```bash
  pnpm --filter @omnifi/reconciliation-worker check --pool-id <POOL_ID>
  ```

### Scenario B: True Reserve Divergence (Flash Loan / Untracked Transfer / Bug)
1. **Immediately initiate RB-001 (Emergency Protocol Pause)** for the affected pool.
2. Quarantine the pool from the routing graph by disabling it via API admin or setting `status = quarantined` in `pools` table.
3. Compute exact delta between deposits, withdrawals, swaps, and fee earnings.
4. Prepare compensating transaction through Multi-Sig if divergence was caused by non-standard fee-on-transfer mechanics or rounding discrepancy.
5. Re-enable pool once invariant is mathematically proven and balanced.

