import {
  FEE_DENOMINATOR,
  MAX_SQRT_PRICE,
  MAX_TICK,
  MIN_SQRT_PRICE,
  MIN_TICK,
  MINIMUM_LIQUIDITY,
  TICK_ARRAY_SIZE,
} from './constants';
import {
  ClmmSwapQuote,
  ClmmSwapQuoteParams,
  SwapQuoteParams,
  SwapQuoteResult,
} from './types';
import { getTickArrayStartIndex, getTickOffsetInArray } from './pda';

/**
 * Integer square root using Babylonian method.
 */
export function sqrt(y: bigint): bigint {
  if (y > 3n) {
    let z = y;
    let x = y / 2n + 1n;
    while (x < z) {
      z = x;
      x = (y / x + x) / 2n;
    }
    return z;
  } else if (y !== 0n) {
    return 1n;
  }
  return 0n;
}

export function mulDivDown(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('Division by zero');
  return (a * b) / c;
}

export function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) throw new Error('Division by zero');
  const prod = a * b;
  if (prod === 0n) return 0n;
  return (prod - 1n) / c + 1n;
}

/**
 * Quotes exact input swap output and fee breakdown for Constant Product AMM.
 */
export function quoteExactInput(params: SwapQuoteParams): SwapQuoteResult {
  const { amountIn, reserveIn, reserveOut, feeTier, protocolFeeFraction = 0 } = params;
  if (!amountIn || amountIn <= 0n) throw new Error('Invalid input amount');
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error('Insufficient pool liquidity');

  const feeAmount = mulDivUp(amountIn, BigInt(feeTier), FEE_DENOMINATOR);
  const amountInAfterFee = amountIn - feeAmount;

  const numerator = reserveOut * amountInAfterFee;
  const denominator = reserveIn + amountInAfterFee;
  const amountOut = numerator / denominator;

  const protocolFeeAmount =
    protocolFeeFraction > 0
      ? mulDivDown(feeAmount, BigInt(protocolFeeFraction), FEE_DENOMINATOR)
      : 0n;

  // Price impact in basis points (1 bp = 0.01% = 1e-4)
  const idealOutput = (amountIn * reserveOut) / reserveIn;
  const priceImpactBps =
    idealOutput > 0n
      ? Math.max(0, Number(((idealOutput - amountOut) * 10000n) / idealOutput))
      : 0;

  return {
    amountIn,
    amountOut,
    feeAmount,
    protocolFeeAmount,
    priceImpactBps,
  };
}

/**
 * Quotes required input for an exact output swap for Constant Product AMM.
 */
export function quoteExactOutput(params: SwapQuoteParams): SwapQuoteResult {
  const { amountOut, reserveIn, reserveOut, feeTier, protocolFeeFraction = 0 } = params;
  if (!amountOut || amountOut <= 0n) throw new Error('Invalid output amount');
  if (amountOut >= reserveOut) throw new Error('Amount out exceeds pool reserves');

  const numerator = reserveIn * amountOut;
  const denominator = reserveOut - amountOut;
  const amountInAfterFee = (numerator - 1n) / denominator + 1n;

  const feeMultiplier = FEE_DENOMINATOR - BigInt(feeTier);
  const amountIn = mulDivUp(amountInAfterFee, FEE_DENOMINATOR, feeMultiplier);
  const feeAmount = amountIn - amountInAfterFee;

  const protocolFeeAmount =
    protocolFeeFraction > 0
      ? mulDivDown(feeAmount, BigInt(protocolFeeFraction), FEE_DENOMINATOR)
      : 0n;

  const idealOutput = (amountIn * reserveOut) / reserveIn;
  const priceImpactBps =
    idealOutput > 0n
      ? Math.max(0, Number(((idealOutput - amountOut) * 10000n) / idealOutput))
      : 0;

  return {
    amountIn,
    amountOut,
    feeAmount,
    protocolFeeAmount,
    priceImpactBps,
  };
}

/**
 * Calculates liquidity shares minted for a deposit for Constant Product AMM.
 */
export function quoteAddLiquidity(
  amount0Desired: bigint,
  amount1Desired: bigint,
  reserve0: bigint,
  reserve1: bigint,
  lpSupply: bigint,
): { amount0: bigint; amount1: bigint; liquidity: bigint } {
  if (lpSupply === 0n) {
    const initialLiquidity = sqrt(amount0Desired * amount1Desired);
    if (initialLiquidity <= MINIMUM_LIQUIDITY) {
      throw new Error('Initial liquidity below minimum locked amount');
    }
    return {
      amount0: amount0Desired,
      amount1: amount1Desired,
      liquidity: initialLiquidity - MINIMUM_LIQUIDITY,
    };
  }

  const amount1Optimal = mulDivDown(amount0Desired, reserve1, reserve0);
  if (amount1Optimal <= amount1Desired) {
    const liquidity0 = mulDivDown(amount0Desired, lpSupply, reserve0);
    const liquidity1 = mulDivDown(amount1Optimal, lpSupply, reserve1);
    const liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    return {
      amount0: amount0Desired,
      amount1: amount1Optimal,
      liquidity,
    };
  } else {
    const amount0Optimal = mulDivDown(amount1Desired, reserve0, reserve1);
    const liquidity0 = mulDivDown(amount0Optimal, lpSupply, reserve0);
    const liquidity1 = mulDivDown(amount1Desired, lpSupply, reserve1);
    const liquidity = liquidity0 < liquidity1 ? liquidity0 : liquidity1;
    return {
      amount0: amount0Optimal,
      amount1: amount1Desired,
      liquidity,
    };
  }
}

// ---------------------------------------------------------
// Concentrated Liquidity (CLMM) Math
// ---------------------------------------------------------

const TICK_RATIOS: readonly bigint[] = [
  0xfffcb933bd6fad37aa2d162d1a594001n,
  0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,
  0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,
  0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,
  0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,
  0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,
  0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,
  0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,
  0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,
  0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,
  0x48a170391f7dc42444e8fa2n,
];

const U256_MAX = (1n << 256n) - 1n;

/**
 * Calculates sqrt(1.0001^tick) * 2^64 as a Q32.64 fixed-point integer.
 */
export function getSqrtPriceAtTick(tick: number): bigint {
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error('Tick out of bounds');
  }

  const absTick = Math.abs(tick);
  let ratio = (absTick & 0x1) !== 0 ? TICK_RATIOS[0]! : 1n << 128n;

  for (let i = 1; i < TICK_RATIOS.length; i++) {
    if ((absTick & (1 << i)) !== 0) {
      ratio = (ratio * TICK_RATIOS[i]!) >> 128n;
    }
  }

  if (tick > 0) {
    ratio = U256_MAX / ratio;
  }

  // Convert from Q128.128 to Q32.64 by shifting right by 64 bits (rounding up)
  const remainder = ratio & ((1n << 64n) - 1n);
  const sqrtPriceX64 = (ratio >> 64n) + (remainder === 0n ? 0n : 1n);

  return sqrtPriceX64;
}

/**
 * Calculates the greatest tick value such that getSqrtPriceAtTick(tick) <= sqrtPriceX64.
 */
export function getTickAtSqrtPrice(sqrtPriceX64: bigint): number {
  if (sqrtPriceX64 < MIN_SQRT_PRICE || sqrtPriceX64 > MAX_SQRT_PRICE) {
    throw new Error('Sqrt price out of bounds');
  }

  let low = MIN_TICK;
  let high = MAX_TICK;

  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    const p = getSqrtPriceAtTick(mid);
    if (p <= sqrtPriceX64) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  return low;
}

/**
 * Computes token 0 delta between two sqrt prices:
 * delta_x = L * (sqrt_b - sqrt_a) / (sqrt_a * sqrt_b)
 */
export function getAmount0Delta(
  sqrtRatioAX64: bigint,
  sqrtRatioBX64: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [a, b] =
    sqrtRatioAX64 < sqrtRatioBX64
      ? [sqrtRatioAX64, sqrtRatioBX64]
      : [sqrtRatioBX64, sqrtRatioAX64];

  if (a === 0n || liquidity === 0n) return 0n;

  const diff = b - a;
  const numerator1 = liquidity << 64n;
  const product = numerator1 * diff;
  const denominator = a * b;

  if (roundUp) {
    if (product === 0n) return 0n;
    return (product - 1n) / denominator + 1n;
  } else {
    return product / denominator;
  }
}

/**
 * Computes token 1 delta between two sqrt prices:
 * delta_y = L * (sqrt_b - sqrt_a) / 2^64
 */
export function getAmount1Delta(
  sqrtRatioAX64: bigint,
  sqrtRatioBX64: bigint,
  liquidity: bigint,
  roundUp: boolean,
): bigint {
  const [a, b] =
    sqrtRatioAX64 < sqrtRatioBX64
      ? [sqrtRatioAX64, sqrtRatioBX64]
      : [sqrtRatioBX64, sqrtRatioAX64];

  if (liquidity === 0n) return 0n;

  const diff = b - a;
  const prod = liquidity * diff;

  if (roundUp) {
    if (prod === 0n) return 0n;
    return (prod - 1n) / (1n << 64n) + 1n;
  } else {
    return prod >> 64n;
  }
}

/**
 * Calculates the next sqrt price given an input token amount.
 */
export function getNextSqrtPriceFromInput(
  sqrtPriceX64: bigint,
  liquidity: bigint,
  amountIn: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPriceX64 === 0n || liquidity === 0n || amountIn === 0n) {
    return sqrtPriceX64;
  }

  if (zeroForOne) {
    // Price decreases: sqrt_next = L * sqrt / (L + amount_in * sqrt / 2^64)
    const numerator = (liquidity << 64n) * sqrtPriceX64;
    const productIn = amountIn * sqrtPriceX64;
    const denominator = (liquidity << 64n) + productIn;
    return (numerator + denominator - 1n) / denominator;
  } else {
    // Price increases: sqrt_next = sqrt + (amount_in * 2^64 / L)
    const quotient = mulDivDown(amountIn, 1n << 64n, liquidity);
    return sqrtPriceX64 + quotient;
  }
}

/**
 * Calculates the next sqrt price given an output token amount.
 */
export function getNextSqrtPriceFromOutput(
  sqrtPriceX64: bigint,
  liquidity: bigint,
  amountOut: bigint,
  zeroForOne: boolean,
): bigint {
  if (sqrtPriceX64 === 0n || liquidity === 0n || amountOut === 0n) {
    return sqrtPriceX64;
  }

  if (zeroForOne) {
    // Price decreases: sqrt_next = sqrt - (amount_out * 2^64 / L)
    const quotient = mulDivUp(amountOut, 1n << 64n, liquidity);
    if (sqrtPriceX64 <= quotient) {
      throw new Error('Math overflow: amount out exceeds pool price limit');
    }
    return sqrtPriceX64 - quotient;
  } else {
    // Price increases: sqrt_next = L * sqrt / (L - amount_out * sqrt / 2^64)
    const numerator = (liquidity << 64n) * sqrtPriceX64;
    const productOut = amountOut * sqrtPriceX64;
    const lShift = liquidity << 64n;
    if (lShift <= productOut) {
      throw new Error('Math overflow: output amount exceeds liquidity capacity');
    }
    const denominator = lShift - productOut;
    return (numerator + denominator - 1n) / denominator;
  }
}

export interface SwapStepResult {
  sqrtPriceNextX64: bigint;
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
}

/**
 * Computes the result of a single swap step within one tick interval.
 */
export function computeSwapStep(
  sqrtPriceCurrentX64: bigint,
  sqrtPriceTargetX64: bigint,
  liquidity: bigint,
  amountRemaining: bigint,
  feeTier: number,
  isExactInput: boolean,
  zeroForOne: boolean,
): SwapStepResult {
  if (liquidity === 0n) {
    return {
      sqrtPriceNextX64: sqrtPriceTargetX64,
      amountIn: 0n,
      amountOut: 0n,
      feeAmount: 0n,
    };
  }

  const feeTierBig = BigInt(feeTier);

  if (isExactInput) {
    const amountRemainingLessFee = mulDivDown(
      amountRemaining,
      FEE_DENOMINATOR - feeTierBig,
      FEE_DENOMINATOR,
    );

    const maxAmountIn = zeroForOne
      ? getAmount0Delta(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, true)
      : getAmount1Delta(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, true);

    let nextPrice: bigint;
    let stepIn: bigint;

    if (amountRemainingLessFee >= maxAmountIn) {
      nextPrice = sqrtPriceTargetX64;
      stepIn = maxAmountIn;
    } else {
      nextPrice = getNextSqrtPriceFromInput(
        sqrtPriceCurrentX64,
        liquidity,
        amountRemainingLessFee,
        zeroForOne,
      );
      stepIn = zeroForOne
        ? getAmount0Delta(nextPrice, sqrtPriceCurrentX64, liquidity, true)
        : getAmount1Delta(sqrtPriceCurrentX64, nextPrice, liquidity, true);
    }

    const stepOut = zeroForOne
      ? getAmount1Delta(nextPrice, sqrtPriceCurrentX64, liquidity, false)
      : getAmount0Delta(sqrtPriceCurrentX64, nextPrice, liquidity, false);

    const stepFee =
      nextPrice === sqrtPriceTargetX64
        ? mulDivUp(stepIn, feeTierBig, FEE_DENOMINATOR - feeTierBig)
        : amountRemaining > stepIn
        ? amountRemaining - stepIn
        : 0n;

    return {
      sqrtPriceNextX64: nextPrice,
      amountIn: stepIn,
      amountOut: stepOut,
      feeAmount: stepFee,
    };
  } else {
    // Exact output calculation
    const maxAmountOut = zeroForOne
      ? getAmount1Delta(sqrtPriceTargetX64, sqrtPriceCurrentX64, liquidity, false)
      : getAmount0Delta(sqrtPriceCurrentX64, sqrtPriceTargetX64, liquidity, false);

    let nextPrice: bigint;
    let stepOut: bigint;

    if (amountRemaining >= maxAmountOut) {
      nextPrice = sqrtPriceTargetX64;
      stepOut = maxAmountOut;
    } else {
      nextPrice = getNextSqrtPriceFromOutput(
        sqrtPriceCurrentX64,
        liquidity,
        amountRemaining,
        zeroForOne,
      );
      stepOut = zeroForOne
        ? getAmount1Delta(nextPrice, sqrtPriceCurrentX64, liquidity, false)
        : getAmount0Delta(sqrtPriceCurrentX64, nextPrice, liquidity, false);
    }

    const stepIn = zeroForOne
      ? getAmount0Delta(nextPrice, sqrtPriceCurrentX64, liquidity, true)
      : getAmount1Delta(sqrtPriceCurrentX64, nextPrice, liquidity, true);

    const stepFee = mulDivUp(stepIn, feeTierBig, FEE_DENOMINATOR - feeTierBig);

    return {
      sqrtPriceNextX64: nextPrice,
      amountIn: stepIn,
      amountOut: stepOut,
      feeAmount: stepFee,
    };
  }
}

/**
 * Simulates a full concentrated liquidity swap across ticks.
 */
export function quoteClmmSwap(params: ClmmSwapQuoteParams): ClmmSwapQuote {
  const {
    sqrtPriceCurrentX64,
    currentTick,
    liquidity: initialLiquidity,
    amount,
    feeTier,
    tickSpacing,
    zeroForOne,
    isExactInput,
    sqrtPriceLimitX64 = zeroForOne ? MIN_SQRT_PRICE + 1n : MAX_SQRT_PRICE - 1n,
    tickArrays,
  } = params;

  if (amount <= 0n) throw new Error('Zero swap amount');

  let currentSqrtPrice = sqrtPriceCurrentX64;
  let currentLiquidity = initialLiquidity;
  let remainingAmount = amount;
  let totalAmountIn = 0n;
  let totalAmountOut = 0n;
  let totalFeeAmount = 0n;
  const crossedTicks: number[] = [];

  const maxSteps = 100;
  let steps = 0;

  while (remainingAmount > 0n && currentSqrtPrice !== sqrtPriceLimitX64 && steps < maxSteps) {
    steps++;

    // Find next target tick
    let nextTick: number;
    let nextTargetSqrtPrice: bigint;

    if (!tickArrays || tickArrays.size === 0) {
      // If tick arrays are not provided, swap directly against constant liquidity towards limit
      nextTargetSqrtPrice = sqrtPriceLimitX64;
      nextTick = getTickAtSqrtPrice(nextTargetSqrtPrice);
    } else if (zeroForOne) {
      // Sweeping left (decreasing price)
      const startTick = getTickArrayStartIndex(currentTick, tickSpacing);
      const prevBoundaryTick = startTick - 1;
      let candidateTick = prevBoundaryTick;

      // Search tick arrays for initialized tick < currentTick
      const array = tickArrays.get(startTick);
      if (array) {
        const currentOffset = Math.min(
          TICK_ARRAY_SIZE - 1,
          Math.max(0, getTickOffsetInArray(currentTick, startTick, tickSpacing)),
        );
        for (let offset = currentOffset - 1; offset >= 0; offset--) {
          if (array.ticks[offset]?.initialized) {
            candidateTick = startTick + offset * tickSpacing;
            break;
          }
        }
      }

      nextTick = candidateTick;
      if (nextTick < MIN_TICK) nextTick = MIN_TICK;
      nextTargetSqrtPrice = getSqrtPriceAtTick(nextTick);
      if (nextTargetSqrtPrice < sqrtPriceLimitX64) {
        nextTargetSqrtPrice = sqrtPriceLimitX64;
      }
    } else {
      // Sweeping right (increasing price)
      const startTick = getTickArrayStartIndex(currentTick, tickSpacing);
      const nextBoundaryTick = startTick + TICK_ARRAY_SIZE * tickSpacing;
      let candidateTick = nextBoundaryTick;

      const array = tickArrays.get(startTick);
      if (array) {
        const currentOffset = Math.min(
          TICK_ARRAY_SIZE - 1,
          Math.max(0, getTickOffsetInArray(currentTick, startTick, tickSpacing)),
        );
        for (let offset = currentOffset + 1; offset < TICK_ARRAY_SIZE; offset++) {
          if (array.ticks[offset]?.initialized) {
            candidateTick = startTick + offset * tickSpacing;
            break;
          }
        }
      }

      nextTick = candidateTick;
      if (nextTick > MAX_TICK) nextTick = MAX_TICK;
      nextTargetSqrtPrice = getSqrtPriceAtTick(nextTick);
      if (nextTargetSqrtPrice > sqrtPriceLimitX64) {
        nextTargetSqrtPrice = sqrtPriceLimitX64;
      }
    }

    const step = computeSwapStep(
      currentSqrtPrice,
      nextTargetSqrtPrice,
      currentLiquidity,
      remainingAmount,
      feeTier,
      isExactInput,
      zeroForOne,
    );

    if (isExactInput) {
      remainingAmount -= step.amountIn + step.feeAmount;
      totalAmountIn += step.amountIn + step.feeAmount;
      totalAmountOut += step.amountOut;
      totalFeeAmount += step.feeAmount;
    } else {
      remainingAmount -= step.amountOut;
      totalAmountIn += step.amountIn + step.feeAmount;
      totalAmountOut += step.amountOut;
      totalFeeAmount += step.feeAmount;
    }

    currentSqrtPrice = step.sqrtPriceNextX64;

    // Check if tick crossed
    if (currentSqrtPrice === nextTargetSqrtPrice && nextTargetSqrtPrice !== sqrtPriceLimitX64) {
      crossedTicks.push(nextTick);
      // Update liquidity from tick net if available
      if (tickArrays) {
        const arrStart = getTickArrayStartIndex(nextTick, tickSpacing);
        const array = tickArrays.get(arrStart);
        if (array) {
          const offset = getTickOffsetInArray(nextTick, arrStart, tickSpacing);
          const t = array.ticks[offset];
          if (t && t.initialized) {
            if (zeroForOne) {
              currentLiquidity -= t.liquidityNet;
            } else {
              currentLiquidity += t.liquidityNet;
            }
          }
        }
      }
    }
  }

  const tickAfter = getTickAtSqrtPrice(currentSqrtPrice);

  // Price impact in basis points (1 bp = 0.01% = 1e-4)
  // idealOutput computed at spot price:
  // P = sqrtPrice^2 / 2^128
  let priceImpactBps = 0;
  if (totalAmountIn > 0n && totalAmountOut > 0n) {
    if (zeroForOne) {
      // 0 -> 1: idealOutput = amountIn * (sqrtPriceCurrentX64^2) / 2^128
      const numerator = totalAmountIn * sqrtPriceCurrentX64 * sqrtPriceCurrentX64;
      const idealOut = numerator >> 128n;
      if (idealOut > 0n && idealOut > totalAmountOut) {
        priceImpactBps = Number(((idealOut - totalAmountOut) * 10000n) / idealOut);
      }
    } else {
      // 1 -> 0: idealOutput = amountIn * 2^128 / (sqrtPriceCurrentX64^2)
      const denom = sqrtPriceCurrentX64 * sqrtPriceCurrentX64;
      if (denom > 0n) {
        const idealOut = (totalAmountIn << 128n) / denom;
        if (idealOut > 0n && idealOut > totalAmountOut) {
          priceImpactBps = Number(((idealOut - totalAmountOut) * 10000n) / idealOut);
        }
      }
    }
  }

  return {
    amountIn: totalAmountIn,
    amountOut: totalAmountOut,
    feeAmount: totalFeeAmount,
    sqrtPriceAfterX64: currentSqrtPrice,
    tickAfter,
    crossedTicks,
    priceImpactBps,
  };
}
