import { OmniFiDatabaseClient } from './client';
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

export class InMemoryDatabaseClient implements OmniFiDatabaseClient {
  private readonly networks = new Map<string, DbNetwork>();
  private readonly tokens = new Map<string, DbToken>();
  private readonly pools = new Map<string, DbPool>();
  private readonly swaps = new Map<string, DbSwap>();
  private readonly swapCompositeKeys = new Set<string>(); // "networkId:txHash:eventIndex"
  private readonly positions = new Map<string, DbLiquidityPosition>();
  private readonly positionEvents: DbPositionEvent[] = [];
  private readonly chainEvents: DbChainEvent[] = [];
  private readonly checkpoints = new Map<string, DbIndexerCheckpoint>();
  private readonly reorgs: DbIndexerReorg[] = [];
  private readonly reconciliationRuns: DbReconciliationRun[] = [];
  private readonly auditLogs: DbAuditLog[] = [];

  // Networks
  public async insertNetwork(network: DbNetwork): Promise<void> {
    this.networks.set(network.networkId, { ...network });
  }

  public async getNetwork(networkId: string): Promise<DbNetwork | undefined> {
    return this.networks.get(networkId);
  }

  public async listNetworks(): Promise<DbNetwork[]> {
    return Array.from(this.networks.values());
  }

  // Tokens
  public async insertToken(token: DbToken): Promise<void> {
    if (!this.networks.has(token.networkId)) {
      throw new Error(`Foreign key violation: network ${token.networkId} does not exist`);
    }
    this.tokens.set(token.tokenId, { ...token });
  }

  public async getToken(tokenId: string): Promise<DbToken | undefined> {
    return this.tokens.get(tokenId);
  }

  public async listTokens(networkId?: string): Promise<DbToken[]> {
    let result = Array.from(this.tokens.values());
    if (networkId) {
      result = result.filter((t) => t.networkId === networkId);
    }
    return result;
  }

  // Pools
  public async insertPool(pool: DbPool): Promise<void> {
    if (!this.networks.has(pool.networkId)) {
      throw new Error(`Foreign key violation: network ${pool.networkId} does not exist`);
    }
    if (!this.tokens.has(pool.token0Id) || !this.tokens.has(pool.token1Id)) {
      throw new Error('Foreign key violation: token0 or token1 does not exist');
    }
    this.pools.set(pool.poolId, { ...pool });
  }

  public async getPool(poolId: string): Promise<DbPool | undefined> {
    return this.pools.get(poolId);
  }

  public async listPools(networkId?: string): Promise<DbPool[]> {
    let result = Array.from(this.pools.values());
    if (networkId) {
      result = result.filter((p) => p.networkId === networkId);
    }
    return result;
  }

  public async updatePoolState(
    poolId: string,
    state: {
      reserve0?: bigint;
      reserve1?: bigint;
      sqrtPriceX64?: bigint;
      currentTick?: number;
      liquidity?: bigint;
      protocolFeeFraction?: number;
    },
  ): Promise<void> {
    const existing = this.pools.get(poolId);
    if (!existing) return;
    this.pools.set(poolId, {
      ...existing,
      ...state,
    });
  }

  // Swaps (with unique composite constraint (networkId, txHash, eventIndex))
  public async insertSwap(swap: DbSwap): Promise<void> {
    const compositeKey = `${swap.networkId}:${swap.txHash}:${swap.eventIndex}`;
    if (this.swapCompositeKeys.has(compositeKey)) {
      // Idempotency: Duplicate event silently ignored or error thrown depending on ON CONFLICT DO NOTHING
      return;
    }
    this.swapCompositeKeys.add(compositeKey);
    this.swaps.set(swap.swapId, { ...swap });
  }

  public async listSwapsByPool(poolId: string, limit = 50): Promise<DbSwap[]> {
    return Array.from(this.swaps.values())
      .filter((s) => s.poolId === poolId)
      .sort((a, b) => Number(b.blockNumberOrSlot - a.blockNumberOrSlot))
      .slice(0, limit);
  }

  // Positions
  public async upsertPosition(position: DbLiquidityPosition): Promise<void> {
    this.positions.set(position.positionId, { ...position, updatedAt: new Date() });
  }

  public async getPosition(positionId: string): Promise<DbLiquidityPosition | undefined> {
    return this.positions.get(positionId);
  }

  public async getPositionByOnchain(
    networkId: string,
    onchainPositionId: string,
  ): Promise<DbLiquidityPosition | undefined> {
    return Array.from(this.positions.values()).find(
      (p) => p.networkId === networkId && p.onchainPositionId === onchainPositionId,
    );
  }

  public async listPositionsByOwner(owner: string, networkId?: string): Promise<DbLiquidityPosition[]> {
    return Array.from(this.positions.values()).filter(
      (p) =>
        p.owner.toLowerCase() === owner.toLowerCase() &&
        (!networkId || p.networkId === networkId),
    );
  }

  // Position Events
  public async insertPositionEvent(event: DbPositionEvent): Promise<void> {
    this.positionEvents.push({ ...event });
  }

  public async listPositionEvents(positionId: string): Promise<DbPositionEvent[]> {
    return this.positionEvents.filter((e) => e.positionId === positionId);
  }

  // Chain Events & Checkpoints
  public async insertChainEvent(event: DbChainEvent): Promise<void> {
    this.chainEvents.push({ ...event });
  }

  public async listChainEvents(
    networkId: string,
    fromBlockOrSlot: bigint,
    toBlockOrSlot: bigint,
  ): Promise<DbChainEvent[]> {
    return this.chainEvents.filter(
      (e) =>
        e.networkId === networkId &&
        e.blockNumberOrSlot >= fromBlockOrSlot &&
        e.blockNumberOrSlot <= toBlockOrSlot,
    );
  }

  public async getCheckpoint(networkId: string): Promise<DbIndexerCheckpoint | undefined> {
    return this.checkpoints.get(networkId);
  }

  public async updateCheckpoint(checkpoint: DbIndexerCheckpoint): Promise<void> {
    this.checkpoints.set(checkpoint.networkId, { ...checkpoint, updatedAt: new Date() });
  }

  // Reorg Recovery: Roll back unfinalized events back to commonAncestorBlock
  public async rollbackUnfinalizedEvents(
    networkId: string,
    commonAncestorBlock: bigint,
  ): Promise<number> {
    let rolledBackCount = 0;

    // 1. Roll back unfinalized swaps
    for (const [swapId, swap] of Array.from(this.swaps.entries())) {
      if (
        swap.networkId === networkId &&
        swap.blockNumberOrSlot > commonAncestorBlock &&
        !swap.finalized
      ) {
        this.swaps.delete(swapId);
        const compositeKey = `${swap.networkId}:${swap.txHash}:${swap.eventIndex}`;
        this.swapCompositeKeys.delete(compositeKey);
        rolledBackCount++;
      }
    }

    // 2. Roll back unfinalized chain events
    const initialEventsLen = this.chainEvents.length;
    for (let i = this.chainEvents.length - 1; i >= 0; i--) {
      const e = this.chainEvents[i];
      if (
        e &&
        e.networkId === networkId &&
        e.blockNumberOrSlot > commonAncestorBlock &&
        !e.finalized
      ) {
        this.chainEvents.splice(i, 1);
      }
    }
    rolledBackCount += initialEventsLen - this.chainEvents.length;

    // 3. Rewind checkpoint
    const cp = this.checkpoints.get(networkId);
    if (cp) {
      cp.lastScannedBlockOrSlot = commonAncestorBlock;
      cp.updatedAt = new Date();
    }

    return rolledBackCount;
  }

  public async recordReorg(reorg: DbIndexerReorg): Promise<void> {
    this.reorgs.push({ ...reorg });
  }

  // Reconciliation Runs
  public async insertReconciliationRun(run: DbReconciliationRun): Promise<void> {
    this.reconciliationRuns.push({ ...run });
  }

  public async listReconciliationRuns(poolId?: string, limit = 50): Promise<DbReconciliationRun[]> {
    let list = this.reconciliationRuns;
    if (poolId) {
      list = list.filter((r) => r.poolId === poolId);
    }
    return list.slice(-limit).reverse();
  }

  // Audit
  public async logAudit(audit: DbAuditLog): Promise<void> {
    this.auditLogs.push({ ...audit });
  }
}

