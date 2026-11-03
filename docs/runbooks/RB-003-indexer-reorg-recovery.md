# Operational Runbook: RB-003 Indexer Chain Reorganization Recovery

## 1. Overview & Triggers
Public blockchain consensus can experience block reorganizations (reorgs). While shallow reorgs (1–3 blocks) are resolved automatically by the indexer confirmation depth window, deep reorgs (>5 blocks) trigger alerting and may require manual oversight.

### Triggers:
- `alert: OmniFiDeepReorgDetected` (`omnifi_reorg_depth_blocks > 5`)
- Block hash mismatch between consecutive indexed blocks and the canonical tip.

---

## 2. Reorg Detection & Diagnostic Procedure

### Step 2.1: Identify Reorg Boundaries
1. Query the indexer database for conflicting block heights:
   ```sql
   SELECT block_number, block_hash, parent_hash, status, created_at
   FROM indexed_blocks
   WHERE network_id = 'eip155:1'
   ORDER BY block_number DESC LIMIT 20;
   ```
2. Query the canonical RPC node to find the common ancestor block:
   ```bash
   cast block <BLOCK_NUMBER> --rpc-url <RPC_URL> --field hash
   ```
3. Calculate the reorg depth $D = \text{CurrentTip} - \text{CommonAncestor}$.

---

## 3. Automated & Manual Rollback Execution

### Step 3.1: Trigger Automated Database Rewind
The indexer incorporates an atomic checkpoint rewind mechanism:
```bash
# Rewind indexed state to the verified common ancestor block
pnpm --filter @omnifi/indexer-evm rewind --network eip155:1 --target-block <COMMON_ANCESTOR_BLOCK>
```
This triggers an atomic transaction:
1. Deletes all recorded `swaps`, `mints`, and `burns` where `block_number > target_block`.
2. Restores `pool_reserves` to the snapshot recorded at `target_block`.
3. Marks conflicting blocks in `indexed_blocks` as `orphaned`.

### Step 3.2: Re-Index Canonical Chain
1. Resume the indexer daemon:
   ```bash
   docker restart omnifi-indexer-evm
   ```
2. Monitor log output until the indexer catches up with canonical head:
   ```bash
   docker logs -f omnifi-indexer-evm | grep -E "Processed block|Synced"
   ```

---

## 4. Post-Recovery Verification
- [ ] Verify `omnifi_reorg_depth_blocks` has returned to `0`.
- [ ] Confirm `select count(*) from pools where state is null` returns 0.
- [ ] Execute test quote via `apiClient.getQuote(...)` to verify route graph validity.

