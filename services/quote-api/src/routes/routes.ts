import { parseAssetRef } from '@omnifi/domain';
import { findRoutes, PoolGraph } from '@omnifi/quote-engine';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendProblemDetails } from '../errors/problem-details';
import { RoutesQuerySchema } from '../validation/schemas';

function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (typeof obj === 'object') {
    const res: any = {};
    for (const [key, value] of Object.entries(obj)) {
      res[key] = serializeBigInts(value);
    }
    return res;
  }
  return obj;
}

export function registerRoutesDiscovery(fastify: FastifyInstance, graph: PoolGraph) {
  fastify.get('/api/v1/routes', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = RoutesQuerySchema.safeParse(request.query);
    if (!parseResult.success) {
      const invalidParams = parseResult.error.errors.map((e) => ({
        name: e.path.join('.'),
        reason: e.message,
      }));
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Parameters',
        'One or more query parameters failed validation.',
        request.url,
        invalidParams,
      );
    }

    const { tokenIn: rawTokenIn, tokenOut: rawTokenOut, maxHops } = parseResult.data;

    const tokenIn = parseAssetRef(rawTokenIn)!;
    const tokenOut = parseAssetRef(rawTokenOut)!;

    if (tokenIn.namespace !== tokenOut.namespace) {
      return sendProblemDetails(
        reply,
        400,
        'Cross-Chain Routing Unsupported',
        `Routes between differing namespaces (${tokenIn.namespace} -> ${tokenOut.namespace}) are not supported.`,
        request.url,
      );
    }

    const candidatePaths = findRoutes(graph, tokenIn, tokenOut, { maxHops, maxPaths: 20 });

    const response = {
      tokenIn: rawTokenIn,
      tokenOut: rawTokenOut,
      totalRoutesFound: candidatePaths.length,
      routes: candidatePaths.map((hops, idx) => ({
        routeIndex: idx,
        hopCount: hops.length,
        hops: hops.map((h) => ({
          poolId: h.pool.poolId,
          poolType: h.pool.poolType,
          feeTier: h.feeTier,
          tokenIn: h.tokenIn,
          tokenOut: h.tokenOut,
        })),
      })),
    };

    return reply.status(200).send(serializeBigInts(response));
  });
}

