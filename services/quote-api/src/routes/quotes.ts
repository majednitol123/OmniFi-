import { parseAssetRef } from '@omnifi/domain';
import { findBestQuote, findRoutes, PoolGraph } from '@omnifi/quote-engine';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { sendProblemDetails } from '../errors/problem-details';
import { quoteLatencySeconds, quoteRequestsTotal } from '../metrics';

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

export function registerQuoteRoutes(fastify: FastifyInstance, graph: PoolGraph) {
  const resolveAssetRef = (raw: string) => {
    if (!raw) return null;
    if (raw.includes(':')) {
      const parsed = parseAssetRef(raw);
      if (parsed) return parsed;
    }
    // If pure address or symbol, search pool graph tokens
    for (const p of graph.allPools()) {
      if (p.token0.address.toLowerCase() === raw.toLowerCase()) return p.token0;
      if (p.token1.address.toLowerCase() === raw.toLowerCase()) return p.token1;
    }
    return null;
  };

  const handleUnifiedQuote = async (request: FastifyRequest, reply: FastifyReply) => {
    const start = performance.now();
    const query = (request.query || {}) as Record<string, any>;
    const body = (request.body || {}) as Record<string, any>;

    const rawTokenIn = (body.tokenIn || body.sourceToken || query.tokenIn || query.sourceToken || '') as string;
    const rawTokenOut = (body.tokenOut || body.targetToken || query.tokenOut || query.targetToken || '') as string;
    const rawAmount = (body.amount || body.amountIn || query.amount || query.amountIn || '') as string;
    const allowSplits = body.allowSplits === true || query.allowSplits === 'true' || query.allowSplits === true;

    if (!rawTokenIn || !rawTokenOut || !rawAmount) {
      quoteRequestsTotal.inc({ status: 'bad_request' });
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Parameters',
        'Required parameters missing: tokenIn (or sourceToken), tokenOut (or targetToken), and amount (or amountIn).',
        request.url,
      );
    }

    const resolveAsset = (raw: string, paramName: string) => {
      if (!raw) return { error: 'missing' };
      if (raw.includes(':')) {
        const parsed = parseAssetRef(raw);
        if (!parsed) return { error: 'malformed', paramName };
        return { asset: parsed };
      }
      // If it is a bare symbol (e.g. 'USDC', 'ETH', 'BTC'), reject as malformed (symbol-only forbidden per §10.1)
      if (!raw.startsWith('0x') && raw.length < 32) {
        return { error: 'malformed', paramName };
      }
      // If it is a valid hex address or base58 address, resolve from pool graph
      for (const p of graph.allPools()) {
        if (p.token0.address.toLowerCase() === raw.toLowerCase()) return { asset: p.token0 };
        if (p.token1.address.toLowerCase() === raw.toLowerCase()) return { asset: p.token1 };
      }
      return { error: 'not_found' };
    };

    const resIn = resolveAsset(rawTokenIn, 'tokenIn');
    if (resIn.error === 'malformed') {
      quoteRequestsTotal.inc({ status: 'bad_request' });
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Parameters',
        `Token identifier "${rawTokenIn}" is malformed. Symbol-only asset identifiers are prohibited (§10.1). Use CAIP-19 asset reference or contract address.`,
        request.url,
        [{ name: 'tokenIn', reason: 'Must be a valid CAIP-19 asset reference or address' }],
      );
    }

    const resOut = resolveAsset(rawTokenOut, 'tokenOut');
    if (resOut.error === 'malformed') {
      quoteRequestsTotal.inc({ status: 'bad_request' });
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Parameters',
        `Token identifier "${rawTokenOut}" is malformed. Symbol-only asset identifiers are prohibited (§10.1). Use CAIP-19 asset reference or contract address.`,
        request.url,
        [{ name: 'tokenOut', reason: 'Must be a valid CAIP-19 asset reference or address' }],
      );
    }

    const tokenIn = resIn.asset;
    const tokenOut = resOut.asset;

    if (!tokenIn || !tokenOut) {
      quoteRequestsTotal.inc({ status: 'token_not_found' });
      return sendProblemDetails(
        reply,
        404,
        'Asset Not Found',
        `Could not resolve asset metadata for "${rawTokenIn}" or "${rawTokenOut}".`,
        request.url,
      );
    }

    if (tokenIn.namespace !== tokenOut.namespace) {
      quoteRequestsTotal.inc({ status: 'cross_chain_unsupported' });
      return sendProblemDetails(
        reply,
        400,
        'Cross-Chain Routing Unsupported',
        `Swaps between differing namespaces (${tokenIn.namespace} -> ${tokenOut.namespace}) are not supported in native single-chain router.`,
        request.url,
      );
    }

    let amountIn: bigint;
    try {
      amountIn = BigInt(rawAmount);
      if (amountIn <= 0n) throw new Error('Amount must be positive');
    } catch {
      quoteRequestsTotal.inc({ status: 'bad_request' });
      return sendProblemDetails(
        reply,
        400,
        'Invalid Amount',
        `Amount "${rawAmount}" is not a valid positive integer string.`,
        request.url,
      );
    }

    const candidatePaths = findRoutes(graph, tokenIn, tokenOut, { maxHops: 3, maxPaths: 20 });
    if (candidatePaths.length === 0) {
      quoteRequestsTotal.inc({ status: 'no_route' });
      return sendProblemDetails(
        reply,
        404,
        'No Liquidity Route Found',
        `No connected liquidity pool route exists between ${rawTokenIn} and ${rawTokenOut}.`,
        request.url,
      );
    }

    const quote = findBestQuote(candidatePaths, tokenIn, tokenOut, amountIn, { allowSplits });
    if (!quote) {
      quoteRequestsTotal.inc({ status: 'insufficient_liquidity' });
      return sendProblemDetails(
        reply,
        422,
        'Insufficient Liquidity',
        'Available liquidity along discovered routes is insufficient to fulfill the requested amount.',
        request.url,
      );
    }

    const duration = (performance.now() - start) / 1000;
    quoteLatencySeconds.observe(duration);
    quoteRequestsTotal.inc({ status: 'success' });

    return reply.status(200).send({
      ...serializeBigInts(quote),
      tokenIn: rawTokenIn,
      tokenOut: rawTokenOut,
      amountIn: quote.amountIn.toString(),
      amountOut: quote.amountOut.toString(),
      executionPrice: quote.executionPrice,
      priceImpactBps: quote.priceImpact.bps,
      estimatedGasOrFee: '250000',
    });
  };

  // Register GET and POST variants for maximum client compatibility
  fastify.get('/quote', handleUnifiedQuote);
  fastify.get('/quotes', handleUnifiedQuote);
  fastify.get('/api/v1/quote', handleUnifiedQuote);
  fastify.get('/api/v1/quotes', handleUnifiedQuote);

  fastify.post('/quote', handleUnifiedQuote);
  fastify.post('/quotes', handleUnifiedQuote);
  fastify.post('/api/v1/quote', handleUnifiedQuote);
  fastify.post('/api/v1/quotes', handleUnifiedQuote);
}
