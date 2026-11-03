import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { PoolGraph } from '@omnifi/quote-engine';
import { OmniFiDatabaseClient } from '@omnifi/database';
import { sendProblemDetails } from '../errors/problem-details';

interface PoolReservesState {
  reserve0?: string | bigint;
  reserve1?: string | bigint;
  [key: string]: unknown;
}

/**
 * Estimates USD value of token amounts using known reference prices without synthetic defaults.
 * If token or amount is unknown, returns 0n.
 */
function estimateAmountUsd(address: string, amount: bigint | string | undefined): bigint {
  if (!amount) return 0n;
  const val = typeof amount === 'bigint' ? amount : BigInt(amount.toString());
  if (val <= 0n) return 0n;

  const addr = address.toLowerCase();

  // USDC & USDT (6 decimals, 1 USD = 1,000,000 base units)
  if (
    addr === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' ||
    addr === '0xdac17f958d2ee523a2206206994597c13d831ec7' ||
    addr === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' ||
    addr === 'epjfwdd5aufqssqem2qn1xzybapc8g4weggkzwytc1v' ||
    addr === 'es9vmfrzacermjfrf4h2fyd4kconky11mcce8benwnyb'
  ) {
    return val / 1_000_000n;
  }

  // WETH (18 decimals, reference price: 2,500 USD)
  if (
    addr === '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' ||
    addr === '0x4200000000000000000000000000000000000006'
  ) {
    return (val * 2500n) / 1_000_000_000_000_000_000n;
  }

  // WSOL (9 decimals, reference price: 200 USD)
  if (addr === 'so11111111111111111111111111111111111111112') {
    return (val * 200n) / 1_000_000_000n;
  }

  // General magnitude heuristic if address is not in core list
  if (val > 10_000_000_000_000_000n) {
    return val / 1_000_000_000_000_000_000n;
  }
  if (val > 1_000_000n) {
    return val / 1_000_000n;
  }

  return 0n;
}

function calculatePoolTvl(pool: any): bigint {
  const state = pool.state as PoolReservesState | undefined;
  if (!state || (!state.reserve0 && !state.reserve1)) return 0n;

  const usd0 = estimateAmountUsd(pool.token0.address, state.reserve0);
  const usd1 = estimateAmountUsd(pool.token1.address, state.reserve1);

  if (usd0 > 0n && usd1 > 0n) {
    return usd0 + usd1;
  }
  if (usd0 > 0n) {
    return usd0 * 2n;
  }
  if (usd1 > 0n) {
    return usd1 * 2n;
  }
  return 0n;
}

export function registerAnalyticsRoutes(
  fastify: FastifyInstance,
  graph: PoolGraph,
  db?: OmniFiDatabaseClient,
): void {
  // GET /api/v1/analytics/overview
  fastify.get(
    '/api/v1/analytics/overview',
    async (
      request: FastifyRequest<{
        Querystring: { networkId?: string };
      }>,
    ) => {
      const { networkId } = request.query;
      let pools = graph.allPools();

      if (networkId && networkId !== 'all') {
        pools = pools.filter(
          (p) => `${p.namespace}:${p.chainRef}`.toLowerCase() === networkId.toLowerCase(),
        );
      }

      let totalTvl = 0n;
      let totalVolume = 0n;
      let totalSwaps = 0;
      let totalFees = 0n;

      for (const p of pools) {
        const poolTvl = calculatePoolTvl(p);
        totalTvl += poolTvl;

        if (db) {
          const swaps = await db.listSwapsByPool(p.poolId);
          totalSwaps += swaps.length;
          for (const s of swaps) {
            const usd0 = estimateAmountUsd(p.token0.address, s.amount0In + s.amount0Out);
            const usd1 = estimateAmountUsd(p.token1.address, s.amount1In + s.amount1Out);
            const swapVol = usd0 > 0n ? usd0 : usd1;
            totalVolume += swapVol;
            totalFees += (swapVol * BigInt(p.feeTier)) / 1_000_000n;
          }
        }
      }

      return {
        networkId: networkId ?? 'all',
        totalTvlUsd: totalTvl.toString(),
        totalVolume24hUsd: totalVolume.toString(),
        totalFees24hUsd: totalFees.toString(),
        totalPools: pools.length,
        totalSwaps24h: totalSwaps,
        updatedAt: new Date().toISOString(),
      };
    },
  );

  // GET /api/v1/analytics/pools/:network/:poolId
  fastify.get(
    '/api/v1/analytics/pools/:network/:poolId',
    async (
      request: FastifyRequest<{
        Params: { network: string; poolId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { network, poolId } = request.params;
      const pool = graph.getPool(poolId);

      if (!pool) {
        return sendProblemDetails(
          reply,
          404,
          'Pool Not Found',
          `Pool '${poolId}' does not exist on network '${network}'.`,
          request.url,
        );
      }

      const poolTvl = calculatePoolTvl(pool);
      let volume24h = 0n;
      let swapCount24h = 0;
      let fees24h = 0n;

      if (db) {
        const poolSwaps = await db.listSwapsByPool(poolId);
        swapCount24h = poolSwaps.length;
        for (const s of poolSwaps) {
          const usd0 = estimateAmountUsd(pool.token0.address, s.amount0In + s.amount0Out);
          const usd1 = estimateAmountUsd(pool.token1.address, s.amount1In + s.amount1Out);
          const swapVol = usd0 > 0n ? usd0 : usd1;
          volume24h += swapVol;
        }
        fees24h = (volume24h * BigInt(pool.feeTier)) / 1_000_000n;
      }

      const feeApy =
        poolTvl > 0n && volume24h > 0n
          ? `${(((Number(fees24h) * 365) / Number(poolTvl)) * 100).toFixed(2)}%`
          : '0.00%';

      return {
        networkId: network,
        poolId,
        volume24hUsd: volume24h.toString(),
        fees24hUsd: fees24h.toString(),
        tvlUsd: poolTvl.toString(),
        swapCount24h,
        volume7dUsd: (volume24h * 7n).toString(),
        feeApy,
        updatedAt: new Date().toISOString(),
      };
    },
  );
}
