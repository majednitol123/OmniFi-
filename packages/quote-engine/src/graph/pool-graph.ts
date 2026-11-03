import { AssetRef, assetRefEquals, PoolRef, RouteHop, serializeAssetRef } from '@omnifi/domain';

export class PoolGraph {
  private readonly adjacencyList = new Map<string, RouteHop[]>();
  private readonly poolsById = new Map<string, PoolRef>();
  private readonly tokensByRef = new Map<string, AssetRef>();

  public addPool(pool: PoolRef): void {
    this.poolsById.set(pool.poolId, pool);

    const token0Key = serializeAssetRef(pool.token0);
    const token1Key = serializeAssetRef(pool.token1);

    this.tokensByRef.set(token0Key, pool.token0);
    this.tokensByRef.set(token1Key, pool.token1);

    // Forward edge: token0 -> token1
    const forwardHop: RouteHop = {
      pool,
      tokenIn: pool.token0,
      tokenOut: pool.token1,
      feeTier: pool.feeTier,
    };

    // Backward edge: token1 -> token0
    const backwardHop: RouteHop = {
      pool,
      tokenIn: pool.token1,
      tokenOut: pool.token0,
      feeTier: pool.feeTier,
    };

    if (!this.adjacencyList.has(token0Key)) {
      this.adjacencyList.set(token0Key, []);
    }
    this.adjacencyList.get(token0Key)!.push(forwardHop);

    if (!this.adjacencyList.has(token1Key)) {
      this.adjacencyList.set(token1Key, []);
    }
    this.adjacencyList.get(token1Key)!.push(backwardHop);
  }

  public getEdges(token: AssetRef): RouteHop[] {
    const key = serializeAssetRef(token);
    return this.adjacencyList.get(key) ?? [];
  }

  public hasToken(token: AssetRef): boolean {
    const key = serializeAssetRef(token);
    return this.tokensByRef.has(key);
  }

  public getPool(poolId: string): PoolRef | undefined {
    return this.poolsById.get(poolId);
  }

  public allPools(): PoolRef[] {
    return Array.from(this.poolsById.values());
  }

  public allTokens(): AssetRef[] {
    return Array.from(this.tokensByRef.values());
  }

  public clear(): void {
    this.adjacencyList.clear();
    this.poolsById.clear();
    this.tokensByRef.clear();
  }
}

