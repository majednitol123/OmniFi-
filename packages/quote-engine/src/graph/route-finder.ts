import { AssetRef, assetRefEquals, RouteHop, serializeAssetRef } from '@omnifi/domain';
import { PoolGraph } from './pool-graph';

export interface RouteFinderOptions {
  maxHops?: number;
  maxPaths?: number;
}

const DEFAULT_MAX_HOPS = 3;
const DEFAULT_MAX_PATHS = 20;

/**
 * Finds candidate route paths between tokenIn and tokenOut using bounded depth-first search.
 * Ensures cycle-free paths (no visited tokens or pools repeated) and enforces max hops.
 */
export function findRoutes(
  graph: PoolGraph,
  tokenIn: AssetRef,
  tokenOut: AssetRef,
  options: RouteFinderOptions = {},
): RouteHop[][] {
  const maxHops = options.maxHops ?? DEFAULT_MAX_HOPS;
  const maxPaths = options.maxPaths ?? DEFAULT_MAX_PATHS;

  if (assetRefEquals(tokenIn, tokenOut)) {
    return [];
  }

  const results: RouteHop[][] = [];
  const visitedTokens = new Set<string>();
  const visitedPools = new Set<string>();

  visitedTokens.add(serializeAssetRef(tokenIn));

  function dfs(currentToken: AssetRef, currentPath: RouteHop[]): void {
    if (results.length >= maxPaths) {
      return;
    }

    if (currentPath.length >= maxHops) {
      return;
    }

    const edges = graph.getEdges(currentToken);

    for (const edge of edges) {
      if (results.length >= maxPaths) {
        return;
      }

      const nextTokenKey = serializeAssetRef(edge.tokenOut);
      const poolId = edge.pool.poolId;

      // Disallow revisiting pools
      if (visitedPools.has(poolId)) {
        continue;
      }

      // Check if target reached
      if (assetRefEquals(edge.tokenOut, tokenOut)) {
        results.push([...currentPath, edge]);
        continue;
      }

      // Disallow token cycles
      if (visitedTokens.has(nextTokenKey)) {
        continue;
      }

      // Recurse
      visitedTokens.add(nextTokenKey);
      visitedPools.add(poolId);
      currentPath.push(edge);

      dfs(edge.tokenOut, currentPath);

      // Backtrack
      currentPath.pop();
      visitedPools.delete(poolId);
      visitedTokens.delete(nextTokenKey);
    }
  }

  dfs(tokenIn, []);

  // Sort paths by hop length ascending (shortest routes first)
  results.sort((a, b) => a.length - b.length);

  return results;
}

