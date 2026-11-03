import { AssetRef, PoolRef } from '@omnifi/domain';
import { describe, expect, it } from 'vitest';
import { PoolGraph } from '../graph/pool-graph';

describe('PoolGraph', () => {
  const tokenA: AssetRef = {
    namespace: 'eip155',
    chainRef: '1',
    address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
  };

  const tokenB: AssetRef = {
    namespace: 'eip155',
    chainRef: '1',
    address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
  };

  const tokenC: AssetRef = {
    namespace: 'eip155',
    chainRef: '1',
    address: '0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
  };

  const poolAB: PoolRef = {
    poolId: 'pool-usdc-weth',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: tokenA,
    token1: tokenB,
    feeTier: 3000,
    state: { reserve0: 10_000_000_000n, reserve1: 5_000_000_000_000_000_000n },
  };

  const poolBC: PoolRef = {
    poolId: 'pool-weth-usdt',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: tokenB,
    token1: tokenC,
    feeTier: 3000,
    state: { reserve0: 5_000_000_000_000_000_000n, reserve1: 10_000_000_000n },
  };

  it('adds pools and derives bidirectional hops', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAB);

    const edgesA = graph.getEdges(tokenA);
    expect(edgesA).toHaveLength(1);
    expect(edgesA[0]!.tokenIn).toEqual(tokenA);
    expect(edgesA[0]!.tokenOut).toEqual(tokenB);

    const edgesB = graph.getEdges(tokenB);
    expect(edgesB).toHaveLength(1);
    expect(edgesB[0]!.tokenIn).toEqual(tokenB);
    expect(edgesB[0]!.tokenOut).toEqual(tokenA);
  });

  it('aggregates multiple pools across shared token', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAB);
    graph.addPool(poolBC);

    const edgesB = graph.getEdges(tokenB);
    expect(edgesB).toHaveLength(2);

    expect(graph.allPools()).toHaveLength(2);
    expect(graph.allTokens()).toHaveLength(3);
  });
});

