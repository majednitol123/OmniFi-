import { OmniFiDatabaseClient } from '@omnifi/database';
import { PoolAuditTarget, ReconciliationResult, ReconciliationWorkerConfig } from './types';

export class InvariantAuditor {
  public readonly db: OmniFiDatabaseClient;
  public readonly config: ReconciliationWorkerConfig;

  constructor(db: OmniFiDatabaseClient, config: ReconciliationWorkerConfig = {}) {
    this.db = db;
    this.config = config;
  }

  public async auditPool(target: PoolAuditTarget): Promise<ReconciliationResult> {
    const drift0 =
      target.onchainReserve0 >= target.dbReserve0
        ? target.onchainReserve0 - target.dbReserve0
        : target.dbReserve0 - target.onchainReserve0;

    const drift1 =
      target.onchainReserve1 >= target.dbReserve1
        ? target.onchainReserve1 - target.dbReserve1
        : target.dbReserve1 - target.onchainReserve1;

    const hasDrift = drift0 > 0n || drift1 > 0n;
    const status = hasDrift ? 'DRIFT_DETECTED' : 'OK';
    const runId = `rec-${target.networkId}-${target.poolId}-${Date.now()}`;
    const auditedAt = new Date();

    const result: ReconciliationResult = {
      runId,
      networkId: target.networkId,
      poolId: target.poolId,
      onchainReserve0: target.onchainReserve0,
      dbReserve0: target.dbReserve0,
      drift0,
      onchainReserve1: target.onchainReserve1,
      dbReserve1: target.dbReserve1,
      drift1,
      status,
      auditedAt,
    };

    // Record in database
    await this.db.insertReconciliationRun({
      runId,
      networkId: target.networkId,
      poolId: target.poolId,
      onchainReserve0: target.onchainReserve0,
      dbReserve0: target.dbReserve0,
      drift0,
      onchainReserve1: target.onchainReserve1,
      dbReserve1: target.dbReserve1,
      drift1,
      status,
      auditedAt,
    });

    if (hasDrift) {
      await this.db.logAudit({
        logId: `alert-${runId}`,
        source: 'reconciliation-worker',
        action: 'STATE_DRIFT_ALERT',
        details: {
          networkId: target.networkId,
          poolId: target.poolId,
          drift0: drift0.toString(),
          drift1: drift1.toString(),
          onchain0: target.onchainReserve0.toString(),
          db0: target.dbReserve0.toString(),
          onchain1: target.onchainReserve1.toString(),
          db1: target.dbReserve1.toString(),
        },
        timestamp: auditedAt,
      });
    }

    return result;
  }
}

