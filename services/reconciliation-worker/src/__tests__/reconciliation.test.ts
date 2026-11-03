import { InMemoryDatabaseClient } from '@omnifi/database';
import { describe, expect, it } from 'vitest';
import { AnalyticsEngine } from '../analytics';
import { InvariantAuditor } from '../auditor';

describe('Reconciliation Worker & Analytics (Track P11-D, P11-E)', () => {
  it('passes audit when on-chain state and database state match exactly', async () => {
    const db = new InMemoryDatabaseClient();
    const auditor = new InvariantAuditor(db);

    const result = await auditor.auditPool({
      networkId: 'eip155:1',
      poolId: 'pool-usdc-weth',
      onchainReserve0: 50_000_000_000n,
      onchainReserve1: 25_000_000_000_000_000_000n,
      dbReserve0: 50_000_000_000n,
      dbReserve1: 25_000_000_000_000_000_000n,
    });

    expect(result.status).toBe('OK');
    expect(result.drift0).toBe(0n);
    expect(result.drift1).toBe(0n);

    const runs = await db.listReconciliationRuns('pool-usdc-weth');
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe('OK');
  });

  it('detects state drift and emits alert when on-chain state diverges from DB', async () => {
    const db = new InMemoryDatabaseClient();
    const auditor = new InvariantAuditor(db);

    const result = await auditor.auditPool({
      networkId: 'eip155:1',
      poolId: 'pool-divergent',
      onchainReserve0: 50_000_000_000n,
      onchainReserve1: 25_000_000_000_000_000_000n,
      dbReserve0: 49_999_990_000n, // 10,000 units drift!
      dbReserve1: 25_000_000_000_000_000_000n,
    });

    expect(result.status).toBe('DRIFT_DETECTED');
    expect(result.drift0).toBe(10_000n);
    expect(result.drift1).toBe(0n);

    const runs = await db.listReconciliationRuns('pool-divergent');
    expect(runs.length).toBe(1);
    expect(runs[0]?.status).toBe('DRIFT_DETECTED');
  });

  it('aggregates 24h pool and network analytics metrics', async () => {
    const db = new InMemoryDatabaseClient();
    const networkId = 'eip155:1';
    const poolId = 'evm-v2-usdc-weth';

    await db.insertNetwork({
      networkId,
      name: 'Ethereum Mainnet',
      namespace: 'eip155',
      chainRef: '1',
      nativeAssetSymbol: 'ETH',
      nativeAssetDecimals: 18,
      status: 'active',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token0',
      networkId,
      address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
      symbol: 'USDC',
      name: 'USD Coin',
      decimals: 6,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    await db.insertToken({
      tokenId: 'token1',
      networkId,
      address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
      symbol: 'WETH',
      name: 'Wrapped Ether',
      decimals: 18,
      riskTier: 'LOW',
      createdAt: new Date(),
    });

    await db.insertPool({
      poolId,
      networkId,
      protocol: 'v2',
      token0Id: 'token0',
      token1Id: 'token1',
      feeTier: 3000,
      isPaused: false,
      createdAt: new Date(),
    });

    // Ingest swaps
    await db.insertSwap({
      swapId: 'swap-1',
      networkId,
      poolId,
      txHash: '0x1',
      blockNumberOrSlot: 1000n,
      blockTimestamp: new Date(),
      sender: '0xuser',
      recipient: '0xuser',
      amount0In: 1_000_000_000n,
      amount1In: 0n,
      amount0Out: 0n,
      amount1Out: 500_000_000_000_000_000n,
      eventIndex: 0,
      finalized: true,
      createdAt: new Date(),
    });

    const analytics = new AnalyticsEngine(db);
    const poolStats = await analytics.getPoolAnalytics(poolId);
    expect(poolStats).toBeDefined();
    expect(poolStats?.swapCount24h).toBe(1);
    expect(BigInt(poolStats!.volume24hUsd)).toBeGreaterThan(0n);
    expect(BigInt(poolStats!.fees24hUsd)).toBeGreaterThan(0n);

    const overview = await analytics.getNetworkOverview(networkId);
    expect(overview.totalPools).toBe(1);
    expect(overview.totalSwaps).toBe(1);
    expect(BigInt(overview.totalVolume24hUsd)).toBeGreaterThan(0n);
  });
});

