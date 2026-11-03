import { PoolGraph } from '@omnifi/quote-engine';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendProblemDetails } from '../errors/problem-details';

export function registerPoolsRoutes(fastify: FastifyInstance, graph: PoolGraph): void {
  fastify.get(
    '/api/v1/pools',
    async (
      request: FastifyRequest<{
        Querystring: {
          networkId?: string;
          protocol?: string;
          token?: string;
          limit?: string;
          offset?: string;
        };
      }>,
    ) => {
      let pools = graph.allPools();
      const { networkId, protocol, token, limit = '50', offset = '0' } = request.query;

      if (networkId) {
        pools = pools.filter((p) => `${p.namespace}:${p.chainRef}`.toLowerCase() === networkId.toLowerCase());
      }
      if (protocol) {
        const protoLower = protocol.toLowerCase();
        pools = pools.filter(
          (p) =>
            p.poolType.toLowerCase() === protoLower ||
            (protoLower === 'amm' && p.poolType.toLowerCase().includes('amm')) ||
            (protoLower === 'clmm' && p.poolType.toLowerCase().includes('clmm')),
        );
      }
      if (token) {
        const lowerToken = token.toLowerCase();
        pools = pools.filter(
          (p) =>
            p.token0.address.toLowerCase() === lowerToken ||
            p.token1.address.toLowerCase() === lowerToken,
        );
      }

      const numOffset = Math.max(0, parseInt(offset, 10) || 0);
      const numLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
      const paginated = pools.slice(numOffset, numOffset + numLimit);

      return {
        pools: paginated.map((p) => ({
          poolId: p.poolId,
          networkId: `${p.namespace}:${p.chainRef}`,
          namespace: p.namespace,
          chainRef: p.chainRef,
          poolType: p.poolType,
          token0: p.token0,
          token1: p.token1,
          feeTier: p.feeTier,
          state: serializeBigIntState(p.state),
        })),
        total: pools.length,
        offset: numOffset,
        limit: numLimit,
      };
    },
  );

  fastify.get(
    '/api/v1/pools/:network/:poolId',
    async (
      request: FastifyRequest<{
        Params: { network: string; poolId: string };
      }>,
      reply: FastifyReply,
    ) => {
      const { network, poolId } = request.params;
      const pool = graph.getPool(poolId);

      if (!pool || `${pool.namespace}:${pool.chainRef}`.toLowerCase() !== network.toLowerCase()) {
        return sendProblemDetails(
          reply,
          404,
          'Pool Not Found',
          `Pool ${poolId} on network ${network} was not found.`,
          request.url,
        );
      }

      return {
        poolId: pool.poolId,
        networkId: `${pool.namespace}:${pool.chainRef}`,
        namespace: pool.namespace,
        chainRef: pool.chainRef,
        poolType: pool.poolType,
        token0: pool.token0,
        token1: pool.token1,
        feeTier: pool.feeTier,
        state: serializeBigIntState(pool.state),
      };
    },
  );
}

function serializeBigIntState(state: any): any {
  if (!state || typeof state !== 'object') return state;
  const copy: Record<string, any> = {};
  for (const [key, value] of Object.entries(state)) {
    if (typeof value === 'bigint') {
      copy[key] = value.toString();
    } else if (typeof value === 'object' && value !== null) {
      copy[key] = serializeBigIntState(value);
    } else {
      copy[key] = value;
    }
  }
  return copy;
}
