# Operational Runbook: RB-006 Disaster Recovery & Point-In-Time Backup (PITR)

## 1. Overview
This runbook provides step-by-step instructions for cold-starting, restoring, and verifying the OmniFi data platform (PostgreSQL, Redis caches, and indexer checkpoints) following a catastrophic failure, data corruption, or datacenter outage.

---

## 2. Recovery Objectives
- **RPO (Recovery Point Objective)**: $< 5$ minutes of transactions (via WAL streaming and on-chain immutability).
- **RTO (Recovery Time Objective)**: $< 30$ minutes to full operational API recovery.

---

## 3. Database Restoration Protocol (PostgreSQL)

### Step 3.1: Identify Target Timestamp
Determine target point-in-time prior to corruption incident $T_{\text{target}}$:
```bash
# Example target time
export RESTORE_TARGET_TIME="2026-11-01 16:45:00 UTC"
```

### Step 3.2: Restore Base Backup & Stream WALs
1. Halt existing PostgreSQL container:
   ```bash
   docker stop omnifi-postgres
   ```
2. Restore latest consistent base backup from S3 / cold storage:
   ```bash
   pg_basebackup -h backup.storage.internal -D /var/lib/postgresql/data -U postgres -Fp -Xs -P -v
   ```
3. Configure `recovery.signal` and `postgresql.conf`:
   ```ini
   restore_command = 'aws s3 cp s3://omnifi-backups/wal/%f %p'
   recovery_target_time = '2026-11-01 16:45:00 UTC'
   recovery_target_action = 'promote'
   ```
4. Start database engine:
   ```bash
   docker start omnifi-postgres
   ```
5. Monitor recovery logs:
   ```bash
   docker logs -f omnifi-postgres | grep -i "recovery"
   ```

---

## 4. Cold-Start Dependency Sequencing

When recovering infrastructure from scratch, services MUST be started in strict sequence:
1. **Infrastructure Tier**:
   - PostgreSQL (apply schema migrations: `pnpm --filter @omnifi/database migrate`)
   - Redis cache cluster
2. **Indexing & Telemetry Tier**:
   - `indexer-evm` (synced to checkpoint)
   - `indexer-solana`
   - `reconciliation-worker`
3. **Serving Tier**:
   - `quote-api`
   - `prometheus` & `grafana`

---

## 5. Post-Recovery Verification Drills
- [ ] Run health check: `curl -s http://localhost:3001/health | jq .`
- [ ] Verify Prometheus is scraping `quote-api`: `http://localhost:9090/targets`
- [ ] Run reconciliation check: `pnpm --filter @omnifi/reconciliation-worker check`
- [ ] Perform smoke test swap simulation via `POST /api/v1/simulate`.

