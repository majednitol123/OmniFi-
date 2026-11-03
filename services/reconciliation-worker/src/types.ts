export interface ReconciliationWorkerConfig {
  intervalMs?: number | undefined;
  driftToleranceBps?: number | undefined; // Allowed rounding difference, default 0
}

export interface PoolAuditTarget {
  networkId: string;
  poolId: string;
  onchainReserve0: bigint;
  onchainReserve1: bigint;
  dbReserve0: bigint;
  dbReserve1: bigint;
}

export interface ReconciliationResult {
  runId: string;
  networkId: string;
  poolId: string;
  onchainReserve0: bigint;
  dbReserve0: bigint;
  drift0: bigint;
  onchainReserve1: bigint;
  dbReserve1: bigint;
  drift1: bigint;
  status: 'OK' | 'DRIFT_DETECTED';
  auditedAt: Date;
}

export interface PoolAnalyticsSummary {
  poolId: string;
  networkId: string;
  volume24hUsd: string;
  fees24hUsd: string;
  tvlUsd: string;
  swapCount24h: number;
}

export interface NetworkAnalyticsOverview {
  totalTvlUsd: string;
  totalVolume24hUsd: string;
  totalFees24hUsd: string;
  totalPools: number;
  totalSwaps: number;
}

