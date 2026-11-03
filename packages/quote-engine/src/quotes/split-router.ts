import {
  AssetRef,
  createPriceImpact,
  Route,
  RouteHop,
  RouteSplit,
  SwapQuote,
} from '@omnifi/domain';
import { ExpiryTracker } from '../freshness/expiry-tracker';
import { calculatePriceImpactBps } from './price-impact';
import { calculateRouteQuote } from './quote-calculator';

export interface SplitRouterOptions {
  allowSplits?: boolean;
  ttlMs?: number;
}

export function formatExecutionPrice(
  amountOut: bigint,
  amountIn: bigint,
  scaleDecimals: number = 6,
): string {
  if (amountIn === 0n) return '0.' + '0'.repeat(scaleDecimals);
  const scale = 10n ** BigInt(scaleDecimals);
  const scaled = (amountOut * scale) / amountIn;
  const intPart = scaled / scale;
  const fracPart = (scaled % scale).toString().padStart(scaleDecimals, '0');
  return `${intPart}.${fracPart}`;
}

export function findBestQuote(
  candidatePaths: RouteHop[][],
  tokenIn: AssetRef,
  tokenOut: AssetRef,
  amountIn: bigint,
  options: SplitRouterOptions = {},
): SwapQuote | null {
  if (candidatePaths.length === 0 || amountIn <= 0n) {
    return null;
  }

  const allowSplits = options.allowSplits ?? true;
  const ttlMs = options.ttlMs ?? 15_000;
  const expiry = ExpiryTracker.createExpiry(ttlMs);

  // If only 1 path or splits disabled, evaluate each single path at 100%
  if (candidatePaths.length === 1 || !allowSplits) {
    let bestRoute: Route | null = null;

    for (let i = 0; i < candidatePaths.length; i++) {
      try {
        const route = calculateRouteQuote(candidatePaths[i]!, amountIn, `route-${i}`);
        if (!bestRoute || route.amountOut > bestRoute.amountOut) {
          bestRoute = route;
        }
      } catch {
        // Skip paths with insufficient liquidity
        continue;
      }
    }

    if (!bestRoute || bestRoute.amountOut <= 0n) {
      return null;
    }

    return {
      quoteId: `quote-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      namespace: tokenIn.namespace,
      chainRef: tokenIn.chainRef,
      tokenIn,
      tokenOut,
      amountIn,
      amountOut: bestRoute.amountOut,
      executionPrice: formatExecutionPrice(bestRoute.amountOut, amountIn),
      priceImpact: bestRoute.priceImpact,
      routes: [bestRoute],
      splits: [{ routeIndex: 0, percentage: 100, amountIn, amountOut: bestRoute.amountOut }],
      expiresAt: expiry.expiresAt,
      ttlMs: expiry.ttlMs,
    };
  }

  // Multi-route evaluation: test 100% on Route 0, 100% on Route 1, and split allocations
  const path0 = candidatePaths[0]!;
  const path1 = candidatePaths[1]!;

  const splitPercentages = [
    [100, 0],
    [0, 100],
    [50, 50],
    [70, 30],
    [30, 70],
  ] as const;

  let bestSplitConfig: {
    pct0: number;
    pct1: number;
    route0: Route | null;
    route1: Route | null;
    totalAmountOut: bigint;
  } | null = null;

  for (const [pct0, pct1] of splitPercentages) {
    const amountIn0 = (amountIn * BigInt(pct0)) / 100n;
    const amountIn1 = amountIn - amountIn0;

    let route0: Route | null = null;
    let route1: Route | null = null;
    let totalOut = 0n;

    try {
      if (amountIn0 > 0n) {
        route0 = calculateRouteQuote(path0, amountIn0, 'route-0');
        totalOut += route0.amountOut;
      }
      if (amountIn1 > 0n) {
        route1 = calculateRouteQuote(path1, amountIn1, 'route-1');
        totalOut += route1.amountOut;
      }

      if (
        totalOut > 0n &&
        (!bestSplitConfig || totalOut > bestSplitConfig.totalAmountOut)
      ) {
        bestSplitConfig = {
          pct0,
          pct1,
          route0,
          route1,
          totalAmountOut: totalOut,
        };
      }
    } catch {
      // Continue if split configuration fails
      continue;
    }
  }

  if (!bestSplitConfig || bestSplitConfig.totalAmountOut <= 0n) {
    return null;
  }

  const selectedRoutes: Route[] = [];
  const selectedSplits: RouteSplit[] = [];

  if (bestSplitConfig.pct0 > 0 && bestSplitConfig.route0) {
    const routeIndex = selectedRoutes.length;
    selectedRoutes.push(bestSplitConfig.route0);
    selectedSplits.push({
      routeIndex,
      percentage: bestSplitConfig.pct0,
      amountIn: bestSplitConfig.route0.amountIn,
      amountOut: bestSplitConfig.route0.amountOut,
    });
  }

  if (bestSplitConfig.pct1 > 0 && bestSplitConfig.route1) {
    const routeIndex = selectedRoutes.length;
    selectedRoutes.push(bestSplitConfig.route1);
    selectedSplits.push({
      routeIndex,
      percentage: bestSplitConfig.pct1,
      amountIn: bestSplitConfig.route1.amountIn,
      amountOut: bestSplitConfig.route1.amountOut,
    });
  }

  // Calculate composite price impact using exact weighted BigInt math
  let totalWeightedBps = 0n;
  for (const r of selectedRoutes) {
    totalWeightedBps += BigInt(r.priceImpact.bps) * r.amountIn;
  }
  const compositeBps = amountIn > 0n ? Number(totalWeightedBps / amountIn) : 0;
  const compositePriceImpact = createPriceImpact(compositeBps);

  return {
    quoteId: `quote-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    namespace: tokenIn.namespace,
    chainRef: tokenIn.chainRef,
    tokenIn,
    tokenOut,
    amountIn,
    amountOut: bestSplitConfig.totalAmountOut,
    executionPrice: formatExecutionPrice(bestSplitConfig.totalAmountOut, amountIn),
    priceImpact: compositePriceImpact,
    routes: selectedRoutes,
    splits: selectedSplits,
    expiresAt: expiry.expiresAt,
    ttlMs: expiry.ttlMs,
  };
}

