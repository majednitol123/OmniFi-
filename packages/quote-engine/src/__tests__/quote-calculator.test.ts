import { AssetRef, PoolRef } from '@omnifi/domain';
import { describe, expect, it } from 'vitest';
import { calculateRouteQuote } from '../quotes/quote-calculator';

describe('QuoteCalculator', () => {
  const usdc: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' };
  const weth: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' };
  const usdt: AssetRef = { namespace: 'eip155', chainRef: '1', address: '0xdac17f958d2ee523a2206206994597c13d831ec7' };

  const v2PoolUsdcWeth: PoolRef = {
    poolId: 'usdc-weth-v2',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: usdc,
    token1: weth,
    feeTier: 3000, // 0.30%
    state: {
      reserve0: 10_000_000_000n, // 10,000 USDC
      reserve1: 5_000_000_000_000_000_000n, // 5 WETH (rate = 2000 USDC/ETH)
    },
  };

  const v2PoolWethUsdt: PoolRef = {
    poolId: 'weth-usdt-v2',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: weth,
    token1: usdt,
    feeTier: 3000,
    state: {
      reserve0: 5_000_000_000_000_000_000n, // 5 WETH
      reserve1: 10_000_000_000n, // 10,000 USDT
    },
  };

  it('calculates single-hop V2 route quote correctly', () => {
    const routeHops = [{ pool: v2PoolUsdcWeth, tokenIn: usdc, tokenOut: weth, feeTier: 3000 }];
    const amountIn = 1_000_000n; // 1 USDC

    const quote = calculateRouteQuote(routeHops, amountIn);

    expect(quote.amountIn).toBe(amountIn);
    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.feeBreakdowns).toHaveLength(1);
    expect(quote.feeBreakdowns[0]!.feeAmount).toBeGreaterThan(0n);
    expect(quote.priceImpact.bps).toBeGreaterThanOrEqual(0);
  });

  it('calculates 2-hop route quote chaining outputs and fees', () => {
    const routeHops = [
      { pool: v2PoolUsdcWeth, tokenIn: usdc, tokenOut: weth, feeTier: 3000 },
      { pool: v2PoolWethUsdt, tokenIn: weth, tokenOut: usdt, feeTier: 3000 },
    ];
    const amountIn = 10_000_000n; // 10 USDC

    const quote = calculateRouteQuote(routeHops, amountIn);

    expect(quote.amountIn).toBe(amountIn);
    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.feeBreakdowns).toHaveLength(2);
    expect(quote.feeBreakdowns[0]!.feeTier).toBe(3000);
    expect(quote.feeBreakdowns[1]!.feeTier).toBe(3000);
  });

  it('calculates Solana AMM hop correctly', () => {
    const solSol: AssetRef = { namespace: 'solana', chainRef: 'mainnet-beta', address: 'So11111111111111111111111111111111111111112' };
    const solUsdc: AssetRef = { namespace: 'solana', chainRef: 'mainnet-beta', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' };

    const solanaPool: PoolRef = {
      poolId: 'solana-sol-usdc',
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      poolType: 'solana_amm',
      token0: solUsdc,
      token1: solSol,
      feeTier: 3000,
      state: {
        reserve0: 100_000_000_000n, // 100,000 USDC
        reserve1: 1_000_000_000_000n, // 1,000 SOL
        protocolFeeFraction: 250_000,
      },
    };

    const routeHops = [{ pool: solanaPool, tokenIn: solUsdc, tokenOut: solSol, feeTier: 3000 }];
    const amountIn = 1_000_000n; // 1 USDC

    const quote = calculateRouteQuote(routeHops, amountIn);
    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.feeBreakdowns[0]!.protocolFeeAmount).toBeGreaterThan(0n);
  });
});

