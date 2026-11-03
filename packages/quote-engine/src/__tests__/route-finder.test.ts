import { AssetRef, PoolRef } from '@omnifi/domain';
import { describe, expect, it } from 'vitest';
import { PoolGraph } from '../graph/pool-graph';
import { findRoutes } from '../graph/route-finder';

describe('RouteFinder', () => {
  const tokenA: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x1111111111111111111111111111111111111111' };
  const tokenB: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x2222222222222222222222222222222222222222' };
  const tokenC: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x3333333333333333333333333333333333333333' };
  const tokenD: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x4444444444444444444444444444444444444444' };
  const tokenE: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x5555555555555555555555555555555555555555' };

  const poolAB: PoolRef = { poolId: 'AB', namespace: 'eip155', chainRef: '1', poolType: 'v2', token0: tokenA, token1: tokenB, feeTier: 3000, state: {} };
  const poolBC: PoolRef = { poolId: 'BC', namespace: 'eip155', chainRef: '1', poolType: 'v2', token0: tokenB, token1: tokenC, feeTier: 3000, state: {} };
  const poolAC: PoolRef = { poolId: 'AC', namespace: 'eip155', chainRef: '1', poolType: 'v2', token0: tokenA, token1: tokenC, feeTier: 3000, state: {} };
  const poolCD: PoolRef = { poolId: 'CD', namespace: 'eip155', chainRef: '1', poolType: 'v2', token0: tokenC, token1: tokenD, feeTier: 3000, state: {} };
  const poolDE: PoolRef = { poolId: 'DE', namespace: 'eip155', chainRef: '1', poolType: 'v2', token0: tokenD, token1: tokenE, feeTier: 3000, state: {} };

  it('finds direct 1-hop route', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAB);

    const routes = findRoutes(graph, tokenA, tokenB);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toHaveLength(1);
    expect(routes[0]![0]!.pool.poolId).toBe('AB');
  });

  it('finds multiple routes sorted by hop count', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAC); // 1-hop A -> C
    graph.addPool(poolAB); // 2-hop A -> B -> C
    graph.addPool(poolBC);

    const routes = findRoutes(graph, tokenA, tokenC);
    expect(routes).toHaveLength(2);
    expect(routes[0]).toHaveLength(1); // Direct A -> C
    expect(routes[1]).toHaveLength(2); // Multi-hop A -> B -> C
  });

  it('strictly enforces max hops limit (default 3)', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAB); // A -> B (hop 1)
    graph.addPool(poolBC); // B -> C (hop 2)
    graph.addPool(poolCD); // C -> D (hop 3)
    graph.addPool(poolDE); // D -> E (hop 4 - exceeds 3 hops)

    // A -> D is 3 hops (allowed)
    const routesToD = findRoutes(graph, tokenA, tokenD);
    expect(routesToD).toHaveLength(1);
    expect(routesToD[0]).toHaveLength(3);

    // A -> E would be 4 hops, should return 0 routes
    const routesToE = findRoutes(graph, tokenA, tokenE);
    expect(routesToE).toHaveLength(0);
  });

  it('prevents cycles and duplicate pool usage', () => {
    const graph = new PoolGraph();
    graph.addPool(poolAB);
    graph.addPool(poolBC);
    graph.addPool(poolAC);

    const routes = findRoutes(graph, tokenA, tokenA);
    expect(routes).toHaveLength(0);
  });
});

