import { describe, expect, it } from 'vitest';
import {
  computeSwapStep,
  getAmount0Delta,
  getAmount1Delta,
  getNextSqrtPriceFromInput,
  getNextSqrtPriceFromOutput,
  getSqrtPriceAtTick,
  getTickAtSqrtPrice,
  quoteClmmSwap,
} from '../math';
import {
  MAX_SQRT_PRICE,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MIN_TICK,
} from '../constants';

describe('Solana CLMM Math', () => {
  it('computes exact sqrt price at tick 0 as 2^64', () => {
    const sqrtP = getSqrtPriceAtTick(0);
    expect(sqrtP).toBe(1n << 64n);
    expect(getTickAtSqrtPrice(sqrtP)).toBe(0);
  });

  it('preserves boundary conditions and roundtrip', () => {
    const minP = getSqrtPriceAtTick(MIN_TICK);
    const maxP = getSqrtPriceAtTick(MAX_TICK);

    expect(minP).toBeGreaterThanOrEqual(MIN_SQRT_PRICE);
    expect(maxP).toBeLessThanOrEqual(MAX_SQRT_PRICE);

    const testTicks = [-400000, -10000, -60, 0, 60, 10000, 400000];
    for (const tick of testTicks) {
      const p = getSqrtPriceAtTick(tick);
      const recovered = getTickAtSqrtPrice(p);
      expect(recovered).toBe(tick);
    }
  });

  it('computes amount deltas symmetrically', () => {
    const pLower = getSqrtPriceAtTick(-1000);
    const pUpper = getSqrtPriceAtTick(1000);
    const liquidity = 1_000_000_000n;

    const delta0 = getAmount0Delta(pLower, pUpper, liquidity, false);
    const delta1 = getAmount1Delta(pLower, pUpper, liquidity, false);

    expect(delta0).toBeGreaterThan(0n);
    expect(delta1).toBeGreaterThan(0n);

    // Delta zero when prices equal
    expect(getAmount0Delta(pLower, pLower, liquidity, false)).toBe(0n);
    expect(getAmount1Delta(pLower, pLower, liquidity, false)).toBe(0n);
  });

  it('computes swap step exact input', () => {
    const currentP = getSqrtPriceAtTick(0);
    const targetP = getSqrtPriceAtTick(-100);
    const liquidity = 10_000_000_000n;
    const amountIn = 1_000_000n;

    const step = computeSwapStep(
      currentP,
      targetP,
      liquidity,
      amountIn,
      3000, // 0.30%
      true, // exact input
      true, // zero for one (price drops)
    );

    expect(step.amountIn).toBeGreaterThan(0n);
    expect(step.amountOut).toBeGreaterThan(0n);
    expect(step.feeAmount).toBeGreaterThan(0n);
    expect(step.sqrtPriceNextX64).toBeLessThanOrEqual(currentP);
    expect(step.sqrtPriceNextX64).toBeGreaterThanOrEqual(targetP);
  });

  it('computes swap step exact output', () => {
    const currentP = getSqrtPriceAtTick(0);
    const targetP = getSqrtPriceAtTick(100);
    const liquidity = 10_000_000_000n;
    const amountOut = 500_000n;

    const step = computeSwapStep(
      currentP,
      targetP,
      liquidity,
      amountOut,
      3000,
      false, // exact output
      false, // one for zero (price rises)
    );

    expect(step.amountIn).toBeGreaterThan(0n);
    expect(step.amountOut).toBeGreaterThan(0n);
    expect(step.feeAmount).toBeGreaterThan(0n);
    expect(step.sqrtPriceNextX64).toBeGreaterThanOrEqual(currentP);
    expect(step.sqrtPriceNextX64).toBeLessThanOrEqual(targetP);
  });

  it('quotes full CLMM swap correctly', () => {
    const currentP = getSqrtPriceAtTick(0);
    const quote = quoteClmmSwap({
      sqrtPriceCurrentX64: currentP,
      currentTick: 0,
      liquidity: 50_000_000_000n,
      amount: 10_000_000n,
      feeTier: 3000,
      tickSpacing: 60,
      zeroForOne: true,
      isExactInput: true,
    });

    expect(quote.amountIn).toBe(10_000_000n);
    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.feeAmount).toBeGreaterThan(0n);
    expect(quote.sqrtPriceAfterX64).toBeLessThan(currentP);
    expect(quote.tickAfter).toBeLessThanOrEqual(0);
  });
});
