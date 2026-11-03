import {
  DbAuditLog,
  DbChainEvent,
  DbIndexerCheckpoint,
  DbIndexerReorg,
  DbLiquidityPosition,
  DbNetwork,
  DbPool,
  DbPositionEvent,
  DbReconciliationRun,
  DbSwap,
  DbToken,
} from './types';

export interface OmniFiDatabaseClient {
  // Networks
  insertNetwork(network: DbNetwork): Promise<void>;
  getNetwork(networkId: string): Promise<DbNetwork | undefined>;
  listNetworks(): Promise<DbNetwork[]>;

  // Tokens
  insertToken(token: DbToken): Promise<void>;
  getToken(tokenId: string): Promise<DbToken | undefined>;
  listTokens(networkId?: string): Promise<DbToken[]>;

  // Pools
  insertPool(pool: DbPool): Promise<void>;
  getPool(poolId: string): Promise<DbPool | undefined>;
  listPools(networkId?: string): Promise<DbPool[]>;
  updatePoolState(
    poolId: string,
    state: {
      reserve0?: bigint;
      reserve1?: bigint;
      sqrtPriceX64?: bigint;
      currentTick?: number;
      liquidity?: bigint;
      protocolFeeFraction?: number;
    },
  ): Promise<void>;

  // Swaps (with unique composite constraint (networkId, txHash, eventIndex))
  insertSwap(swap: DbSwap): Promise<void>;
  listSwapsByPool(poolId: string, limit?: number): Promise<DbSwap[]>;

  // Positions
  upsertPosition(position: DbLiquidityPosition): Promise<void>;
  getPosition(positionId: string): Promise<DbLiquidityPosition | undefined>;
  getPositionByOnchain(
    networkId: string,
    onchainPositionId: string,
  ): Promise<DbLiquidityPosition | undefined>;
  listPositionsByOwner(owner: string, networkId?: string): Promise<DbLiquidityPosition[]>;

  // Position Events
  insertPositionEvent(event: DbPositionEvent): Promise<void>;
  listPositionEvents(positionId: string): Promise<DbPositionEvent[]>;

  // Chain Events & Checkpoints
  insertChainEvent(event: DbChainEvent): Promise<void>;
  listChainEvents(
    networkId: string,
    fromBlockOrSlot: bigint,
    toBlockOrSlot: bigint,
  ): Promise<DbChainEvent[]>;
  getCheckpoint(networkId: string): Promise<DbIndexerCheckpoint | undefined>;
  updateCheckpoint(checkpoint: DbIndexerCheckpoint): Promise<void>;

  // Reorg Recovery
  recordReorg(reorg: DbIndexerReorg): Promise<void>;
  rollbackUnfinalizedEvents(networkId: string, commonAncestorBlock: bigint): Promise<number>;

  // Reconciliation
  insertReconciliationRun(run: DbReconciliationRun): Promise<void>;
  listReconciliationRuns(poolId?: string, limit?: number): Promise<DbReconciliationRun[]>;

  // Audit
  logAudit(audit: DbAuditLog): Promise<void>;
}

