import { OmniFiDatabaseClient } from '@omnifi/database';
import { NetworkAnalyticsOverview, PoolAnalyticsSummary } from './types';

function estimateTokenUsd(symbol: string, amount: bigint | undefined, decimals: number): bigint {
  if (!amount || amount <= 0n) return 0n;
  const sym = symbol.toUpperCase();
  const scale = 10n ** BigInt(decimals);

  if (sym === 'USDC' || sym === 'USDT') {
    return scale > 0n ? amount / scale : amount;
  }
  if (sym === 'ETH' || sym === 'WETH') {
    return scale > 0n ? (amount * 2500n) / scale : 0n;
  }
  if (sym === 'SOL' || sym === 'WSOL') {
    return scale > 0n ? (amount * 200n) / scale : 0n;
  }
  return scale > 0n ? amount / scale : 0n;
}

export class AnalyticsEngine {
  public readonly db: OmniFiDatabaseClient;

  constructor(db: OmniFiDatabaseClient) {
    this.db = db;
  }

  public async calculatePoolTvl(pool: {
    token0Id: string;
    token1Id: string;
    reserve0?: bigint | undefined;
    reserve1?: bigint | undefined;
  }): Promise<bigint> {
    if (!pool.reserve0 && !pool.reserve1) return 0n;

    const [tok0, tok1] = await Promise.all([
      this.db.getToken(pool.token0Id),
      this.db.getToken(pool.token1Id),
    ]);

    const usd0 = tok0 && pool.reserve0 ? estimateTokenUsd(tok0.symbol, pool.reserve0, tok0.decimals) : 0n;
    const usd1 = tok1 && pool.reserve1 ? estimateTokenUsd(tok1.symbol, pool.reserve1, tok1.decimals) : 0n;

    if (usd0 > 0n && usd1 > 0n) {
      return usd0 + usd1;
    }
    if (usd0 > 0n) {
      return usd0 * 2n;
    }
    if (usd1 > 0n) {
      return usd1 * 2n;
    }
    return 0n;
  }

  public async getPoolAnalytics(poolId: string): Promise<PoolAnalyticsSummary | undefined> {
    const pool = await this.db.getPool(poolId);
    if (!pool) return undefined;

    const swaps = await this.db.listSwapsByPool(poolId, 1000);
    const now = Date.now();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

    const recentSwaps = swaps.filter((s) => s.blockTimestamp >= oneDayAgo);

    let volume0 = 0n;
    let volume1 = 0n;

    for (const s of recentSwaps) {
      volume0 += s.amount0In + s.amount0Out;
      volume1 += s.amount1In + s.amount1Out;
    }

    const feeBps = BigInt(pool.feeTier);
    const fees0 = (volume0 * feeBps) / 1_000_000n;
    const fees1 = (volume1 * feeBps) / 1_000_000n;

    const tvl = await this.calculatePoolTvl(pool);

    return {
      poolId: pool.poolId,
      networkId: pool.networkId,
      volume24hUsd: (volume0 + volume1).toString(),
      fees24hUsd: (fees0 + fees1).toString(),
      tvlUsd: tvl.toString(),
      swapCount24h: recentSwaps.length,
    };
  }

  public async getNetworkOverview(networkId?: string): Promise<NetworkAnalyticsOverview> {
    const pools = await this.db.listPools(networkId);
    let totalSwaps = 0;
    let totalVolume = 0n;
    let totalFees = 0n;
    let totalTvl = 0n;

    for (const pool of pools) {
      const poolTvl = await this.calculatePoolTvl(pool);
      totalTvl += poolTvl;

      const swaps = await this.db.listSwapsByPool(pool.poolId, 1000);
      totalSwaps += swaps.length;
      for (const s of swaps) {
        const vol = s.amount0In + s.amount1In + s.amount0Out + s.amount1Out;
        totalVolume += vol;
        totalFees += (vol * BigInt(pool.feeTier)) / 1_000_000n;
      }
    }

    return {
      totalTvlUsd: totalTvl.toString(),
      totalVolume24hUsd: totalVolume.toString(),
      totalFees24hUsd: totalFees.toString(),
      totalPools: pools.length,
      totalSwaps,
    };
  }
}
