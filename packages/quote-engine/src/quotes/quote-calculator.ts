import {
  AssetRef,
  assetRefEquals,
  createPriceImpact,
  FeeBreakdown,
  PoolRef,
  Route,
  RouteHop,
} from '@omnifi/domain';
import {
  mulDivDown,
  mulDivUp,
  quoteClmmSwap,
  quoteExactInput as solanaQuoteExactInput,
} from '@omnifi/sdk-solana';
import { buildPriceImpact } from './price-impact';

export interface V2PoolState {
  reserve0: bigint;
  reserve1: bigint;
}

export interface SolanaAmmPoolState {
  reserve0: bigint;
  reserve1: bigint;
  protocolFeeFraction?: number;
}

export interface ClmmPoolStatePayload {
  sqrtPriceX64: bigint;
  currentTick: number;
  liquidity: bigint;
  tickSpacing: number;
}

export interface EvmClmmPoolStatePayload {
  sqrtPriceX96: bigint;
  liquidity: bigint;
  tickSpacing?: number;
}

export interface HopExecutionResult {
  amountOut: bigint;
  feeAmount: bigint;
  protocolFeeAmount: bigint;
  idealHopOutput: bigint;
}

const FEE_DENOMINATOR = 1_000_000n;

/**
 * Computes the swap output for a single hop across any supported pool type.
 */
export function calculateHopOutput(hop: RouteHop, amountIn: bigint): HopExecutionResult {
  if (amountIn <= 0n) {
    throw new Error('Hop input amount must be positive');
  }

  const { pool, tokenIn } = hop;
  const isToken0 = assetRefEquals(tokenIn, pool.token0);

  switch (pool.poolType) {
    case 'v2': {
      const state = pool.state as V2PoolState;
      const reserveIn = isToken0 ? state.reserve0 : state.reserve1;
      const reserveOut = isToken0 ? state.reserve1 : state.reserve0;

      if (reserveIn <= 0n || reserveOut <= 0n) {
        throw new Error(`Insufficient pool reserves in pool ${pool.poolId}`);
      }

      const feeTier = BigInt(pool.feeTier);
      const feeAmount = mulDivUp(amountIn, feeTier, FEE_DENOMINATOR);
      const amountInAfterFee = amountIn - feeAmount;

      const numerator = reserveOut * amountInAfterFee;
      const denominator = reserveIn + amountInAfterFee;
      const amountOut = numerator / denominator;

      const idealHopOutput = (amountIn * reserveOut) / reserveIn;

      return {
        amountOut,
        feeAmount,
        protocolFeeAmount: 0n,
        idealHopOutput,
      };
    }

    case 'solana_amm': {
      const state = pool.state as SolanaAmmPoolState;
      const reserveIn = isToken0 ? state.reserve0 : state.reserve1;
      const reserveOut = isToken0 ? state.reserve1 : state.reserve0;

      const quote = solanaQuoteExactInput({
        amountIn,
        reserveIn,
        reserveOut,
        feeTier: pool.feeTier,
        protocolFeeFraction: state.protocolFeeFraction ?? 0,
      });

      const idealHopOutput = (amountIn * reserveOut) / reserveIn;

      return {
        amountOut: quote.amountOut,
        feeAmount: quote.feeAmount,
        protocolFeeAmount: quote.protocolFeeAmount,
        idealHopOutput,
      };
    }

    case 'solana_clmm': {
      const state = pool.state as ClmmPoolStatePayload;
      const zeroForOne = isToken0;

      const quote = quoteClmmSwap({
        sqrtPriceCurrentX64: state.sqrtPriceX64,
        currentTick: state.currentTick,
        liquidity: state.liquidity,
        amount: amountIn,
        feeTier: pool.feeTier,
        tickSpacing: state.tickSpacing,
        zeroForOne,
        isExactInput: true,
      });

      // Ideal output at spot price:
      let idealHopOutput = 0n;
      if (zeroForOne) {
        // P = sqrtPrice^2 / 2^128
        idealHopOutput = (amountIn * state.sqrtPriceX64 * state.sqrtPriceX64) >> 128n;
      } else {
        const denom = state.sqrtPriceX64 * state.sqrtPriceX64;
        if (denom > 0n) {
          idealHopOutput = (amountIn << 128n) / denom;
        }
      }

      return {
        amountOut: quote.amountOut,
        feeAmount: quote.feeAmount,
        protocolFeeAmount: 0n,
        idealHopOutput,
      };
    }

    case 'v3':
    case 'v4': {
      // EVM CLMM Q96 math or virtual reserves
      const state = pool.state as (EvmClmmPoolStatePayload & V2PoolState);
      if (state.reserve0 && state.reserve1) {
        // Fallback to virtual reserves if present
        const reserveIn = isToken0 ? state.reserve0 : state.reserve1;
        const reserveOut = isToken0 ? state.reserve1 : state.reserve0;
        const feeTier = BigInt(pool.feeTier);
        const feeAmount = mulDivUp(amountIn, feeTier, FEE_DENOMINATOR);
        const amountInAfterFee = amountIn - feeAmount;
        const amountOut = (reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee);
        const idealHopOutput = (amountIn * reserveOut) / reserveIn;
        return {
          amountOut,
          feeAmount,
          protocolFeeAmount: 0n,
          idealHopOutput,
        };
      }

      // If Q96 sqrtPrice and liquidity are present
      const zeroForOne = isToken0;
      const feeTier = BigInt(pool.feeTier);
      const feeAmount = mulDivUp(amountIn, feeTier, FEE_DENOMINATOR);
      const amountInAfterFee = amountIn - feeAmount;

      // Approximate single-interval delta
      // deltaY = L * delta_sqrtP >> 96; deltaX = L * delta_sqrtP / (P1 * P2)
      // When liquidity is non-zero, ideal output is amountIn * P:
      let idealHopOutput = 0n;
      let amountOut = 0n;

      if (zeroForOne) {
        // P = sqrtPrice^2 / 2^192
        idealHopOutput = (amountIn * state.sqrtPriceX96 * state.sqrtPriceX96) >> 192n;
        // Incur slippage relative to liquidity
        const slippageDenominator = state.liquidity > 0n ? state.liquidity : 1_000_000_000_000n;
        const slippageBps = (amountIn * 10000n) / (slippageDenominator + amountIn);
        const clampedBps = slippageBps > 9999n ? 9999n : slippageBps;
        amountOut = (idealHopOutput * (10000n - clampedBps)) / 10000n;
      } else {
        const denom = state.sqrtPriceX96 * state.sqrtPriceX96;
        if (denom > 0n) {
          idealHopOutput = (amountIn << 192n) / denom;
          const slippageDenominator = state.liquidity > 0n ? state.liquidity : 1_000_000_000_000n;
          const slippageBps = (amountIn * 10000n) / (slippageDenominator + amountIn);
          const clampedBps = slippageBps > 9999n ? 9999n : slippageBps;
          amountOut = (idealHopOutput * (10000n - clampedBps)) / 10000n;
        }
      }

      return {
        amountOut,
        feeAmount,
        protocolFeeAmount: 0n,
        idealHopOutput,
      };
    }

    default:
      throw new Error(`Unsupported pool type: ${(pool as any).poolType}`);
  }
}

/**
 * Calculates output, fees, and price impact for an entire candidate route.
 */
export function calculateRouteQuote(routeHops: RouteHop[], amountIn: bigint, routeId?: string): Route {
  if (routeHops.length === 0) {
    throw new Error('Cannot calculate quote for empty route');
  }

  let currentAmount = amountIn;
  let cumulativeIdealOutput = amountIn;
  const feeBreakdowns: FeeBreakdown[] = [];

  for (let i = 0; i < routeHops.length; i++) {
    const hop = routeHops[i]!;
    const hopResult = calculateHopOutput(hop, currentAmount);

    feeBreakdowns.push({
      hopIndex: i,
      poolId: hop.pool.poolId,
      feeTier: hop.feeTier,
      feeAmount: hopResult.feeAmount,
      protocolFeeAmount: hopResult.protocolFeeAmount,
    });

    // Scale cumulative ideal output by hop's ideal rate
    if (currentAmount > 0n) {
      cumulativeIdealOutput = (cumulativeIdealOutput * hopResult.idealHopOutput) / currentAmount;
    }

    currentAmount = hopResult.amountOut;
  }

  const finalAmountOut = currentAmount;
  const priceImpact = buildPriceImpact(cumulativeIdealOutput, finalAmountOut);

  return {
    routeId: routeId ?? `route-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
    hops: routeHops,
    amountIn,
    amountOut: finalAmountOut,
    priceImpact,
    feeBreakdowns,
  };
}

