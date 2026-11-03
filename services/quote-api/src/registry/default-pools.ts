import { OmniFiDatabaseClient } from '@omnifi/database';
import { AssetRef, ChainNamespace, PoolRef, PoolType } from '@omnifi/domain';
import { PoolGraph } from '@omnifi/quote-engine';

export async function loadGraphFromDatabase(db: OmniFiDatabaseClient): Promise<PoolGraph> {
  const graph = new PoolGraph();
  const [dbPools, dbTokens, dbNetworks] = await Promise.all([
    db.listPools(),
    db.listTokens(),
    db.listNetworks(),
  ]);

  if (dbPools.length === 0) {
    return createDefaultGraph();
  }

  const tokensMap = new Map(dbTokens.map((t) => [t.tokenId, t]));
  const networksMap = new Map(dbNetworks.map((n) => [n.networkId, n]));

  for (const pool of dbPools) {
    if (pool.isPaused) continue;
    const token0 = tokensMap.get(pool.token0Id);
    const token1 = tokensMap.get(pool.token1Id);
    const network = networksMap.get(pool.networkId);

    if (!token0 || !token1 || !network) continue;

    const token0Ref: AssetRef = {
      namespace: network.namespace as ChainNamespace,
      chainRef: network.chainRef,
      address: token0.address,
    };

    const token1Ref: AssetRef = {
      namespace: network.namespace as ChainNamespace,
      chainRef: network.chainRef,
      address: token1.address,
    };

    let poolType: PoolType;
    let state: unknown;

    if (network.namespace === 'eip155') {
      if (pool.protocol === 'v2' || pool.protocol === 'clmm') {
        poolType = 'v2';
        state = {
          reserve0: pool.reserve0 ?? 0n,
          reserve1: pool.reserve1 ?? 0n,
        };
      } else {
        continue;
      }
    } else if (network.namespace === 'solana') {
      if (pool.protocol === 'amm') {
        poolType = 'solana_amm';
        state = {
          reserve0: pool.reserve0 ?? 0n,
          reserve1: pool.reserve1 ?? 0n,
          protocolFeeFraction: pool.protocolFeeFraction ?? 0,
        };
      } else if (pool.protocol === 'clmm') {
        poolType = 'solana_clmm';
        state = {
          sqrtPriceX64: pool.sqrtPriceX64 ?? 18446744073709551616n,
          currentTick: pool.currentTick ?? 0,
          liquidity: pool.liquidity ?? 0n,
          tickSpacing: pool.tickSpacing ?? 10,
        };
      } else {
        continue;
      }
    } else {
      continue;
    }

    const poolRef: PoolRef = {
      poolId: pool.poolId,
      namespace: network.namespace as ChainNamespace,
      chainRef: network.chainRef,
      poolType,
      token0: token0Ref,
      token1: token1Ref,
      feeTier: pool.feeTier,
      ...(pool.tickSpacing !== undefined ? { tickSpacing: pool.tickSpacing } : {}),
      state,
    };

    graph.addPool(poolRef);
  }

  return graph;
}

export const ETH_USDC: AssetRef = {
  namespace: 'eip155',
  chainRef: '1',
  address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
};

export const ETH_WETH: AssetRef = {
  namespace: 'eip155',
  chainRef: '1',
  address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
};

export const ETH_USDT: AssetRef = {
  namespace: 'eip155',
  chainRef: '1',
  address: '0xdac17f958d2ee523a2206206994597c13d831ec7',
};

export const SOL_WSOL: AssetRef = {
  namespace: 'solana',
  chainRef: 'mainnet-beta',
  address: 'So11111111111111111111111111111111111111112',
};

export const SOL_USDC: AssetRef = {
  namespace: 'solana',
  chainRef: 'mainnet-beta',
  address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
};

export const SOL_USDT: AssetRef = {
  namespace: 'solana',
  chainRef: 'mainnet-beta',
  address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
};

export function createDefaultGraph(): PoolGraph {
  const graph = new PoolGraph();

  // 1. EVM V2 Pools
  graph.addPool({
    poolId: 'evm-v2-usdc-weth',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: ETH_USDC,
    token1: ETH_WETH,
    feeTier: 3000,
    state: {
      reserve0: 50_000_000_000_000n, // 50M USDC
      reserve1: 25_000_000_000_000_000_000_000n, // 25,000 WETH (2000 USDC/ETH)
    },
  });

  graph.addPool({
    poolId: 'evm-v2-weth-usdt',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: ETH_WETH,
    token1: ETH_USDT,
    feeTier: 3000,
    state: {
      reserve0: 25_000_000_000_000_000_000_000n, // 25,000 WETH
      reserve1: 50_000_000_000_000n, // 50M USDT
    },
  });

  graph.addPool({
    poolId: 'evm-v3-usdc-usdt',
    namespace: 'eip155',
    chainRef: '1',
    poolType: 'v2',
    token0: ETH_USDC,
    token1: ETH_USDT,
    feeTier: 500, // 0.05%
    state: {
      reserve0: 100_000_000_000_000n, // 100M USDC
      reserve1: 100_000_000_000_000n, // 100M USDT
    },
  });

  // 2. Solana Pools
  graph.addPool({
    poolId: 'solana-amm-usdc-wsol',
    namespace: 'solana',
    chainRef: 'mainnet-beta',
    poolType: 'solana_amm',
    token0: SOL_USDC,
    token1: SOL_WSOL,
    feeTier: 3000,
    state: {
      reserve0: 20_000_000_000_000n, // 20M USDC
      reserve1: 100_000_000_000_000n, // 100k SOL (200 USDC/SOL)
      protocolFeeFraction: 250_000,
    },
  });

  graph.addPool({
    poolId: 'solana-clmm-usdc-wsol',
    namespace: 'solana',
    chainRef: 'mainnet-beta',
    poolType: 'solana_clmm',
    token0: SOL_USDC,
    token1: SOL_WSOL,
    feeTier: 500, // 0.05%
    tickSpacing: 10,
    state: {
      sqrtPriceX64: 18446744073709551616n, // 1.0 (or normalized)
      currentTick: 0,
      liquidity: 500_000_000_000_000n,
      tickSpacing: 10,
    },
  });

  graph.addPool({
    poolId: 'solana-amm-wsol-usdt',
    namespace: 'solana',
    chainRef: 'mainnet-beta',
    poolType: 'solana_amm',
    token0: SOL_WSOL,
    token1: SOL_USDT,
    feeTier: 3000,
    state: {
      reserve0: 50_000_000_000_000n,
      reserve1: 10_000_000_000_000n,
      protocolFeeFraction: 250_000,
    },
  });

  return graph;
}

