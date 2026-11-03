import { describe, expect, it } from 'vitest';
import {
  mulDivDown,
  mulDivUp,
  quoteAddLiquidity,
  quoteExactInput,
  quoteExactOutput,
  sqrt,
} from '../math';

describe('Solana AMM Math', () => {
  it('computes integer square root correctly', () => {
    expect(sqrt(0n)).toBe(0n);
    expect(sqrt(1n)).toBe(1n);
    expect(sqrt(4n)).toBe(2n);
    expect(sqrt(9n)).toBe(3n);
    expect(sqrt(100n)).toBe(10n);
    expect(sqrt(1000000000000000000n)).toBe(1000000000n);
  });

  it('computes mulDivDown and mulDivUp', () => {
    expect(mulDivDown(10n, 20n, 5n)).toBe(40n);
    expect(mulDivDown(10n, 20n, 3n)).toBe(66n); // 200/3 = 66.666 -> 66
    expect(mulDivUp(10n, 20n, 3n)).toBe(67n); // 200/3 -> 67
  });

  it('quotes exact input swap adhering to k-monotonicity', () => {
    const reserveIn = 1_000_000_000_000n;
    const reserveOut = 2_000_000_000_000n;
    const amountIn = 10_000_000_000n;

    const quote = quoteExactInput({
      amountIn,
      reserveIn,
      reserveOut,
      feeTier: 3000,
      protocolFeeFraction: 250_000,
    });

    expect(quote.amountOut).toBeGreaterThan(0n);
    expect(quote.feeAmount).toBeGreaterThan(0n);
    expect(quote.protocolFeeAmount).toBeGreaterThan(0n);

    // Invariant check: k_after >= k_before
    const kBefore = reserveIn * reserveOut;
    const kAfter = (reserveIn + amountIn) * (reserveOut - quote.amountOut);
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });

  it('quotes exact output swap adhering to k-monotonicity', () => {
    const reserveIn = 1_000_000_000_000n;
    const reserveOut = 2_000_000_000_000n;
    const amountOut = 10_000_000_000n;

    const quote = quoteExactOutput({
      amountOut,
      reserveIn,
      reserveOut,
      feeTier: 3000,
      protocolFeeFraction: 250_000,
    });

    expect(quote.amountIn).toBeGreaterThan(0n);
    expect(quote.feeAmount).toBeGreaterThan(0n);

    const kBefore = reserveIn * reserveOut;
    const kAfter = (reserveIn + quote.amountIn) * (reserveOut - amountOut);
    expect(kAfter).toBeGreaterThanOrEqual(kBefore);
  });

  it('quotes initial and subsequent liquidity addition', () => {
    // 1. Initial liquidity
    const initial = quoteAddLiquidity(1_000_000n, 4_000_000n, 0n, 0n, 0n);
    expect(initial.liquidity).toBe(sqrt(1_000_000n * 4_000_000n) - 1000n); // 2_000_000 - 1000 = 1_999_000

    // 2. Subsequent liquidity
    const subsequent = quoteAddLiquidity(
      100_000n,
      400_000n,
      1_000_000n,
      4_000_000n,
      2_000_000n,
    );
    expect(subsequent.liquidity).toBe(200_000n);
  });
});

