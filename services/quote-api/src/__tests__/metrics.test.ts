import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { FastifyInstance } from 'fastify';
import { buildServer } from '../server';

describe('Metrics & Observability Integration Tests', () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await buildServer({ enableRateLimit: false });
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
  });

  it('GET /metrics returns Prometheus format with standard metrics', async () => {
    // Make a request first so metrics are observed
    await server.inject({ method: 'GET', url: '/health' });

    const resp = await server.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(resp.statusCode).toBe(200);
    expect(resp.headers['content-type']).toContain('text/plain');

    const body = resp.body;
    expect(body).toContain('omnifi_http_requests_total');
    expect(body).toContain('omnifi_http_request_duration_seconds');
    expect(body).toContain('omnifi_reconciliation_drift_count');
    expect(body).toContain('omnifi_rpc_provider_status');
    expect(body).toContain('provider="alchemy"');
  });

  it('POST /quote calculates real quote and increments quote metrics', async () => {
    const quotePayload = {
      tokenIn: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', // ETH USDC
      tokenOut: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', // ETH WETH
      amount: '1000000000', // 1,000 USDC
      exactIn: true,
    };

    const resp = await server.inject({
      method: 'POST',
      url: '/quote',
      payload: quotePayload,
    });

    expect(resp.statusCode).toBe(200);
    const json = JSON.parse(resp.body);
    expect(json.tokenIn).toBe(quotePayload.tokenIn);
    expect(json.tokenOut).toBe(quotePayload.tokenOut);
    expect(BigInt(json.amountIn)).toBe(1000000000n);
    expect(BigInt(json.amountOut)).toBeGreaterThan(0n);
    expect(json.executionPrice).toBeDefined();

    // Verify metrics updated
    const metricsResp = await server.inject({ method: 'GET', url: '/metrics' });
    expect(metricsResp.body).toContain('omnifi_quote_requests_total{status="success"}');
    expect(metricsResp.body).toContain('omnifi_quote_latency_seconds');
  });
});

