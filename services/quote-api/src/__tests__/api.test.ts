import { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { InMemoryDatabaseClient } from '@omnifi/database';
import { ETH_USDC, ETH_WETH, SOL_USDC, SOL_WSOL } from '../registry/default-pools';
import { buildServer } from '../server';

describe('Quote API Integration Tests', () => {
  let app: FastifyInstance;
  let db: InMemoryDatabaseClient;

  beforeAll(async () => {
    db = new InMemoryDatabaseClient();
    await db.upsertPosition({
      positionId: '1',
      networkId: 'eip155:1',
      poolId: 'evm-clmm-usdc-weth-500',
      owner: '0x1111111111111111111111111111111111111111',
      onchainPositionId: '1',
      tickLower: -120,
      tickUpper: 120,
      liquidity: 1000000000000n,
      tokensOwed0: 50000n,
      tokensOwed1: 25000000000000n,
      status: 'OPEN',
      updatedAt: new Date(),
    });

    app = await buildServer({ enableRateLimit: false, db });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health returns 200 and healthy status', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('healthy');
  });

  it('GET /api/v1/quotes returns optimal quote for valid EVM pair', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      query: {
        tokenIn: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // USDC
        tokenOut: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // WETH
        amountIn: '1000000000', // 1,000 USDC
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.quoteId).toBeDefined();
    expect(body.amountIn).toBe('1000000000');
    expect(BigInt(body.amountOut)).toBeGreaterThan(0n);
    expect(body.routes).toBeDefined();
    expect(body.routes.length).toBeGreaterThan(0);
    expect(body.priceImpact).toBeDefined();
    expect(body.priceImpact.level).toBe('low');
  });

  it('GET /api/v1/quotes returns optimal quote for valid Solana pair', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      query: {
        tokenIn: 'solana:mainnet-beta:EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
        tokenOut: 'solana:mainnet-beta:So11111111111111111111111111111111111111112', // WSOL
        amountIn: '100000000', // 100 USDC
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.quoteId).toBeDefined();
    expect(body.namespace).toBe('solana');
    expect(BigInt(body.amountOut)).toBeGreaterThan(0n);
  });

  it('GET /api/v1/quotes returns 400 Problem Details for malformed token ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      query: {
        tokenIn: 'USDC', // Symbol-only (forbidden)
        tokenOut: 'eip155:1:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amountIn: '1000000',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = JSON.parse(res.body);
    expect(problem.status).toBe(400);
    expect(problem.title).toBe('Invalid Request Parameters');
    expect(problem.invalidParams).toBeDefined();
  });

  it('GET /api/v1/quotes returns 400 Problem Details for cross-chain swap', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/quotes',
      query: {
        tokenIn: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        tokenOut: 'solana:mainnet-beta:So11111111111111111111111111111111111111112',
        amountIn: '1000000',
      },
    });

    expect(res.statusCode).toBe(400);
    expect(res.headers['content-type']).toContain('application/problem+json');
    const problem = JSON.parse(res.body);
    expect(problem.title).toBe('Cross-Chain Routing Unsupported');
  });

  it('GET /api/v1/routes discovers candidate paths', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/routes',
      query: {
        tokenIn: 'eip155:1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        tokenOut: 'eip155:1:0xdac17f958d2ee523a2206206994597c13d831ec7', // USDT
        maxHops: '3',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.totalRoutesFound).toBeGreaterThan(0);
    expect(body.routes).toBeDefined();
  });

  it('POST /api/v1/simulate executes dry-run simulation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/simulate',
      payload: {
        intent: {
          intentId: 'test-intent-1',
          quoteId: 'test-quote-1',
          namespace: 'solana',
          chainRef: 'mainnet-beta',
          to: 'So11111111111111111111111111111111111111112',
          instructions: [
            {
              programId: 'BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2',
              keys: [],
              data: '',
            },
          ],
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.intentId).toBe('test-intent-1');
    expect(body.success).toBeDefined();

    // SSRF Rejection Test (F-07)
    const ssrfRes = await app.inject({
      method: 'POST',
      url: '/api/v1/simulate',
      payload: {
        intent: {
          intentId: 'test-intent-ssrf',
          quoteId: 'test-quote-1',
          namespace: 'solana',
          chainRef: 'mainnet-beta',
          to: 'So11111111111111111111111111111111111111112',
          instructions: [{ programId: 'BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2', keys: [], data: '' }],
        },
        rpcUrl: 'http://169.254.169.254/latest/meta-data/',
      },
    });
    expect(ssrfRes.statusCode).toBe(400);
    const ssrfBody = JSON.parse(ssrfRes.body);
    expect(ssrfBody.title).toBe('SSRF Security Rejection');
  });

  it('GET /api/v1/networks returns supported networks list', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/networks',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.networks.length).toBeGreaterThan(0);
    expect(body.networks.some((n: any) => n.networkId === 'eip155:1')).toBe(true);
    expect(body.networks.some((n: any) => n.networkId === 'solana:mainnet-beta')).toBe(true);
  });

  it('GET /api/v1/tokens returns filtered tokens', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tokens',
      query: { networkId: 'eip155:1' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.tokens.length).toBeGreaterThan(0);
    expect(body.tokens.every((t: any) => t.networkId === 'eip155:1')).toBe(true);
  });

  it('GET /api/v1/tokens/:network/:asset returns specific token metadata', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/tokens/eip155:1/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.symbol).toBe('USDC');
    expect(body.decimals).toBe(6);
  });

  it('GET /api/v1/pools returns list of pools and single pool details', async () => {
    const resList = await app.inject({
      method: 'GET',
      url: '/api/v1/pools',
      query: { protocol: 'v2' },
    });
    expect(resList.statusCode).toBe(200);
    const listBody = JSON.parse(resList.body);
    expect(listBody.pools.length).toBeGreaterThan(0);

    const resSingle = await app.inject({
      method: 'GET',
      url: '/api/v1/pools/eip155:1/evm-v2-usdc-weth',
    });
    expect(resSingle.statusCode).toBe(200);
    const singleBody = JSON.parse(resSingle.body);
    expect(singleBody.poolId).toBe('evm-v2-usdc-weth');
    expect(singleBody.feeTier).toBe(3000);
  });

  it('GET /api/v1/positions queries user positions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      query: { owner: '0x1111111111111111111111111111111111111111' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.positions.length).toBeGreaterThan(0);
    expect(body.positions[0].owner).toBe('0x1111111111111111111111111111111111111111');
  });

  it('GET /api/v1/positions returns truthful empty list for unpopulated owner', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/positions',
      query: { owner: '0x000000000000000000000000000000000000dead' },
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.positions).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('POST /api/v1/positions/collect/prepare prepares fee collection for EVM and Solana', async () => {
    const evmRes = await app.inject({
      method: 'POST',
      url: '/api/v1/positions/collect/prepare',
      payload: {
        namespace: 'eip155',
        networkId: 'eip155:1',
        owner: '0x1111111111111111111111111111111111111111',
        poolId: 'evm-clmm-usdc-weth-500',
        positionId: '42',
      },
    });
    expect(evmRes.statusCode).toBe(200);
    const evmBody = JSON.parse(evmRes.body);
    expect(evmBody.preparedTransaction.data.startsWith('0xfc6f7865')).toBe(true); // collect(CollectParams)

    const solRes = await app.inject({
      method: 'POST',
      url: '/api/v1/positions/collect/prepare',
      payload: {
        namespace: 'solana',
        networkId: 'solana:mainnet-beta',
        owner: 'So11111111111111111111111111111111111111112',
        poolId: 'So11111111111111111111111111111111111111114',
        positionId: 'So11111111111111111111111111111111111111113',
        token0: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        token1: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
      },
    });
    expect(solRes.statusCode).toBe(200);
    const solBody = JSON.parse(solRes.body);
    expect(solBody.preparedTransaction.instructions[0].keys).toHaveLength(9);
    expect(solBody.preparedTransaction.instructions[0].data).toBeDefined();
  });

  it('POST /api/v1/swap/prepare prepares unsigned swap payload', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/swap/prepare',
      payload: {
        namespace: 'eip155',
        networkId: 'eip155:1',
        userAddress: '0x1111111111111111111111111111111111111111',
        protocol: 'v2',
        tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amountIn: '1000000000',
        minAmountOut: '450000000000000000',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.namespace).toBe('eip155');
    expect(body.preparedTransaction.data.startsWith('0x38ed1739')).toBe(true);
    expect(body.preparedTransaction.data.length).toBeGreaterThan(10);

    const solRes = await app.inject({
      method: 'POST',
      url: '/api/v1/swap/prepare',
      payload: {
        namespace: 'solana',
        networkId: 'solana:mainnet-beta',
        userAddress: 'So11111111111111111111111111111111111111112',
        protocol: 'amm',
        tokenIn: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
        tokenOut: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
        amountIn: '10000000',
        minAmountOut: '9900000',
      },
    });
    expect(solRes.statusCode).toBe(200);
    const solBody = JSON.parse(solRes.body);
    expect(solBody.namespace).toBe('solana');
    expect(solBody.preparedTransaction.instructions).toHaveLength(1);
    expect(solBody.preparedTransaction.instructions[0].keys).toHaveLength(9);
    expect(solBody.preparedTransaction.instructions[0].data).toBeDefined();
  });

  it('POST /api/v1/liquidity/add/prepare and remove/prepare return unsigned payloads', async () => {
    const addRes = await app.inject({
      method: 'POST',
      url: '/api/v1/liquidity/add/prepare',
      payload: {
        namespace: 'eip155',
        networkId: 'eip155:1',
        userAddress: '0x1111111111111111111111111111111111111111',
        protocol: 'clmm',
        token0: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        token1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        amount0Desired: '1000000',
        amount1Desired: '500000000000000',
        amount0Min: '990000',
        amount1Min: '495000000000000',
      },
    });
    expect(addRes.statusCode).toBe(200);

    const removeRes = await app.inject({
      method: 'POST',
      url: '/api/v1/liquidity/remove/prepare',
      payload: {
        namespace: 'eip155',
        networkId: 'eip155:1',
        userAddress: '0x1111111111111111111111111111111111111111',
        protocol: 'clmm',
        poolId: 'evm-clmm-usdc-weth-500',
        liquidity: '1000000',
        amount0Min: '990000',
        amount1Min: '495000000000000',
      },
    });
    expect(removeRes.statusCode).toBe(200);
  });

  it('GET /api/v1/analytics/overview and pool analytics return metrics', async () => {
    const resOverview = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/overview',
    });
    expect(resOverview.statusCode).toBe(200);
    const overviewBody = JSON.parse(resOverview.body);
    expect(overviewBody.totalTvlUsd).toBeDefined();
    expect(overviewBody.totalVolume24hUsd).toBeDefined();

    const resPool = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/pools/eip155:1/evm-v2-usdc-weth',
    });
    expect(resPool.statusCode).toBe(200);
    const poolBody = JSON.parse(resPool.body);
    expect(poolBody.poolId).toBe('evm-v2-usdc-weth');
    expect(poolBody.volume24hUsd).toBeDefined();

    const resNotFound = await app.inject({
      method: 'GET',
      url: '/api/v1/analytics/pools/eip155:1/non-existent-pool',
    });
    expect(resNotFound.statusCode).toBe(404);
    const notFoundBody = JSON.parse(resNotFound.body);
    expect(notFoundBody.status).toBe(404);
    expect(notFoundBody.title).toBe('Pool Not Found');
  });

  it('GET /openapi.json and /api/v1/openapi.json serve OpenAPI 3.1.0 document', async () => {
    const resRoot = await app.inject({
      method: 'GET',
      url: '/openapi.json',
    });
    expect(resRoot.statusCode).toBe(200);
    const specRoot = JSON.parse(resRoot.body);
    expect(specRoot.openapi).toBe('3.1.0');
    expect(specRoot.paths['/api/v1/quotes']).toBeDefined();
    expect(specRoot.paths['/api/v1/analytics/overview']).toBeDefined();

    const resV1 = await app.inject({
      method: 'GET',
      url: '/api/v1/openapi.json',
    });
    expect(resV1.statusCode).toBe(200);
    const specV1 = JSON.parse(resV1.body);
    expect(specV1.openapi).toBe('3.1.0');
  });

  describe('Security & Threat Boundary Verification', () => {
    it('rejects GCP metadata SSRF with 400 Problem Details', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/simulate',
        payload: {
          intent: {
            intentId: 'test-gcp-ssrf',
            quoteId: 'test-quote-1',
            namespace: 'solana',
            chainRef: 'mainnet-beta',
            to: 'So11111111111111111111111111111111111111112',
            instructions: [{ programId: 'BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2', keys: [], data: '' }],
          },
          rpcUrl: 'http://metadata.google.internal/computeMetadata/v1/',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('SSRF Security Rejection');
    });

    it('rejects non-HTTP protocols in RPC endpoint', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/simulate',
        payload: {
          intent: {
            intentId: 'test-protocol-ssrf',
            quoteId: 'test-quote-1',
            namespace: 'solana',
            chainRef: 'mainnet-beta',
            to: 'So11111111111111111111111111111111111111112',
            instructions: [{ programId: 'BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2', keys: [], data: '' }],
          },
          rpcUrl: 'gopher://127.0.0.1:6379/_GET',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('SSRF Security Rejection');
    });

    it('rejects negative amountIn with 400 Problem Details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quote',
        query: {
          networkId: 'eip155:1',
          tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
          tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          amountIn: '-1000',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.status).toBe(400);
      expect(body.title).toMatch(/Invalid (Request Parameters|Amount)/);
    });

    it('rejects malformed token identifier with 400 Problem Details', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/quote',
        query: {
          networkId: 'eip155:1',
          tokenIn: 'malformed_address',
          tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
          amountIn: '1000000',
        },
      });
      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.title).toBe('Invalid Request Parameters');
    });

    it('sanitizes SQL injection attempts in network query parameter without throwing 500', async () => {
      const res = await app.inject({
        method: 'GET',
        url: "/api/v1/tokens?networkId=eip155:1' OR '1'='1",
      });
      // Should cleanly return 200 with empty list or 400 parameter rejection, never 500 internal server error
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.tokens).toEqual([]);
      expect(body.total).toBe(0);
    });
  });
});

