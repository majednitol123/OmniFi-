import { createPriceImpact, PriceImpact } from '@omnifi/domain';

/**
 * Computes price impact in basis points from ideal output and actual output.
 * 1 bp = 0.01% = 1e-4.
 */
export function calculatePriceImpactBps(idealOutput: bigint, actualOutput: bigint): number {
  if (idealOutput <= 0n || actualOutput >= idealOutput) {
    return 0;
  }

  const delta = idealOutput - actualOutput;
  const bps = (delta * 10000n) / idealOutput;

  // Clamp to safe range [0, 10000] (up to 100% impact)
  const numBps = Number(bps);
  return Math.min(10000, Math.max(0, numBps));
}

export function buildPriceImpact(idealOutput: bigint, actualOutput: bigint): PriceImpact {
  const bps = calculatePriceImpactBps(idealOutput, actualOutput);
  return createPriceImpact(bps);
}

