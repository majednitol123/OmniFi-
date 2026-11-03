import { AssetRef, PoolRef } from '@omnifi/domain';
import { describe, expect, it } from 'vitest';
import { findBestQuote } from '../quotes/split-router';

describe('SplitRouter', () => {
  const tokenA: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x1111111111111111111111111111111111111111' };
  const tokenB: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0x2222222222222222222222222222222222222222' };

  // Two parallel pools with different reserves
  const pool1: PoolRef = {
    poolId: 'pool-1',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: tokenA,
    token1: tokenB,
    feeTier: 3000,
    state: { reserve0: 10_000_000_000n, reserve1: 10_000_000_000n },
  };

  const pool2: PoolRef = {
    poolId: 'pool-2',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: tokenA,
    token1: tokenB,
    feeTier: 3000,
    state: { reserve0: 10_000_000_000n, reserve1: 10_000_000_000n },
  };

  const path1 = [{ pool: pool1, tokenIn: tokenA, tokenOut: tokenB, feeTier: 3000 }];
  const path2 = [{ pool: pool2, tokenIn: tokenA, tokenOut: tokenB, feeTier: 3000 }];

  it('evaluates split routing and chooses optimal 50/50 split on equal parallel pools', () => {
    // For a large swap (e.g. 2_000_000_000n), splitting 50/50 across two identical pools reduces slippage
    const largeAmount = 2_000_000_000n;
    const quote = findBestQuote([path1, path2], tokenA, tokenB, largeAmount, { allowSplits: true });

    expect(quote).not.toBeNull();
    expect(quote!.amountOut).toBeGreaterThan(0n);
    expect(quote!.splits).toBeDefined();

    // Splitting 50/50 gives higher output than sending 100% through a single pool
    const singleQuote = findBestQuote([path1], tokenA, tokenB, largeAmount, { allowSplits: false });
    expect(quote!.amountOut).toBeGreaterThan(singleQuote!.amountOut);
  });

  it('returns single route when only 1 candidate path is provided', () => {
    const quote = findBestQuote([path1], tokenA, tokenB, 10_000_000n);
    expect(quote).not.toBeNull();
    expect(quote!.routes).toHaveLength(1);
    expect(quote!.splits).toHaveLength(1);
    expect(quote!.splits![0]!.percentage).toBe(100);
  });
});

