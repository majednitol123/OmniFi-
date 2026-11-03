import { describe, expect, it } from 'vitest';
import { ErrorCode, ApiError } from '../errors';
import { OmniFiClient } from '../client';
import { QuoteRequest, QuoteResponse } from '../types';

describe('API Schema Baseline & Error Taxonomy', () => {
  it('enforces stable, unique integer error codes without collisions', () => {
    const values = Object.values(ErrorCode).filter(v => typeof v === 'number') as number[];
    const set = new Set(values);

    expect(set.size).toBe(values.length); // No duplicates
  });

  it('partitions error code categories into distinct thousand-ranges', () => {
    expect(ErrorCode.INTERNAL_ERROR).toBeGreaterThanOrEqual(1000);
    expect(ErrorCode.INTERNAL_ERROR).toBeLessThan(2000);

    expect(ErrorCode.UNSUPPORTED_NETWORK).toBeGreaterThanOrEqual(2000);
    expect(ErrorCode.UNSUPPORTED_NETWORK).toBeLessThan(3000);

    expect(ErrorCode.UNKNOWN_TOKEN).toBeGreaterThanOrEqual(3000);
    expect(ErrorCode.UNKNOWN_TOKEN).toBeLessThan(4000);

    expect(ErrorCode.INSUFFICIENT_LIQUIDITY).toBeGreaterThanOrEqual(4000);
    expect(ErrorCode.INSUFFICIENT_LIQUIDITY).toBeLessThan(5000);

    expect(ErrorCode.SLIPPAGE_EXCEEDED).toBeGreaterThanOrEqual(5000);
    expect(ErrorCode.SLIPPAGE_EXCEEDED).toBeLessThan(6000);

    expect(ErrorCode.INVALID_TICK_RANGE).toBeGreaterThanOrEqual(6000);
    expect(ErrorCode.INVALID_TICK_RANGE).toBeLessThan(7000);
  });

  it('validates QuoteRequest and QuoteResponse wire format (integer string amounts)', () => {
    const req: QuoteRequest = {
      tokenIn: 'eip155:1:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
      tokenOut: 'eip155:1:0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
      amount: '1000000', // 1 USDC in 6 decimals integer string
      exactIn: true,
    };

    expect(/^\d+$/.test(req.amount)).toBe(true);
    expect(typeof req.amount).toBe('string');

    const res: QuoteResponse = {
      tokenIn: req.tokenIn,
      tokenOut: req.tokenOut,
      amountIn: '1000000',
      amountOut: '380000000000000', // 0.00038 WETH
      executionPrice: '0.00038',
      priceImpactBps: 2,
      estimatedGasOrFee: '50000',
    };

    expect(/^\d+$/.test(res.amountIn)).toBe(true);
    expect(/^\d+$/.test(res.amountOut)).toBe(true);
  });

  it('OmniFiClient executes requests and handles API error envelopes', async () => {
    const mockFetch = async (url: string | URL | Request) => {
      const urlStr = url.toString();
      if (urlStr.endsWith('/health')) {
        return {
          ok: true,
          json: async () => ({ status: 'ok', timestamp: '2026-11-01T00:00:00Z', version: '1.0.0' }),
        } as Response;
      }

      if (urlStr.endsWith('/tokens/invalid')) {
        const errorBody: ApiError = {
          code: ErrorCode.UNKNOWN_TOKEN,
          message: 'Requested token not registered',
          userMessage: 'This token could not be found.',
        };
        return {
          ok: false,
          status: 404,
          json: async () => errorBody,
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({}),
      } as Response;
    };

    const client = new OmniFiClient({
      baseUrl: 'http://mock-api.local/api/v1',
      fetchFn: mockFetch as any,
    });

    const health = await client.getHealth();
    expect(health.status).toBe('ok');

    await expect(client.getToken('invalid')).rejects.toThrow('This token could not be found.');
  });
});
