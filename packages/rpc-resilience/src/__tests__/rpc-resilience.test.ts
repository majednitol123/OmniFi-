import { describe, it, expect, vi } from 'vitest';
import {
  CircuitBreaker,
  isRetryableError,
  calculateBackoffWithJitter,
  ResilientRpcClient,
  AllRpcEndpointsFailedError,
} from '../index';

describe('RPC Resilience Suite', () => {
  describe('CircuitBreaker State Transitions', () => {
    it('starts in CLOSED state and allows execution', () => {
      const cb = new CircuitBreaker({ failureThreshold: 3 });
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);
    });

    it('trips from CLOSED to OPEN after consecutive failures reach threshold', () => {
      const cb = new CircuitBreaker({ failureThreshold: 2 });
      cb.recordFailure();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);

      cb.recordFailure();
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canExecute()).toBe(false);
    });

    it('transitions to HALF_OPEN after resetTimeoutMs has elapsed', async () => {
      const cb = new CircuitBreaker({ failureThreshold: 1, resetTimeoutMs: 50 });
      cb.recordFailure();
      expect(cb.getState()).toBe('OPEN');
      expect(cb.canExecute()).toBe(false);

      await new Promise((r) => setTimeout(r, 60));
      expect(cb.getState()).toBe('HALF_OPEN');
      expect(cb.canExecute()).toBe(true);

      // Probe success recovers breaker back to CLOSED
      cb.recordSuccess();
      cb.recordSuccess();
      expect(cb.getState()).toBe('CLOSED');
      expect(cb.canExecute()).toBe(true);
    });
  });

  describe('Transient Error & Retry Logic', () => {
    it('detects retryable HTTP statuses and error messages', () => {
      expect(isRetryableError({ status: 429 })).toBe(true);
      expect(isRetryableError({ status: 503 })).toBe(true);
      expect(isRetryableError(new Error('Rate limit exceeded'))).toBe(true);
      expect(isRetryableError(new Error('ETIMEDOUT connection lost'))).toBe(true);

      expect(isRetryableError({ status: 400 })).toBe(false);
      expect(isRetryableError(new Error('Invalid signature'))).toBe(false);
    });

    it('calculates exponential backoff within bounds', () => {
      const delay0 = calculateBackoffWithJitter(0, { baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 });
      expect(delay0).toBe(100);

      const delay2 = calculateBackoffWithJitter(2, { baseDelayMs: 100, maxDelayMs: 1000, jitterFactor: 0 });
      expect(delay2).toBe(400);

      const delayCapped = calculateBackoffWithJitter(10, { baseDelayMs: 100, maxDelayMs: 500, jitterFactor: 0 });
      expect(delayCapped).toBe(500);
    });
  });

  describe('ResilientRpcClient Multi-Provider Failover', () => {
    it('uses primary endpoint when healthy', async () => {
      const client = new ResilientRpcClient({
        networkId: 'eip155:1',
        endpoints: [
          { name: 'alchemy-primary', url: 'https://eth-mainnet.alchemy.com/v2/demo', priority: 1 },
          { name: 'infura-backup', url: 'https://mainnet.infura.io/v3/demo', priority: 2 },
        ],
      });

      const result = await client.executeRpc(async (url) => {
        expect(url).toBe('https://eth-mainnet.alchemy.com/v2/demo');
        return { blockNumber: 20000000 };
      });

      expect(result.blockNumber).toBe(20000000);
      expect(client.getActiveEndpoint().name).toBe('alchemy-primary');
    });

    it('automatically fails over to secondary endpoint when primary fails', async () => {
      const failoverSpy = vi.fn();

      const client = new ResilientRpcClient({
        networkId: 'eip155:1',
        retryOptions: { maxRetries: 0 },
        endpoints: [
          {
            name: 'primary-failing',
            url: 'https://rpc-fail.internal',
            priority: 1,
            circuitBreakerOptions: { failureThreshold: 1 },
          },
          {
            name: 'secondary-healthy',
            url: 'https://rpc-healthy.internal',
            priority: 2,
          },
        ],
        onFailover: failoverSpy,
      });

      const result = await client.executeRpc(async (url) => {
        if (url.includes('fail')) {
          throw new Error('RPC 503 Service Unavailable');
        }
        return 'success-from-backup';
      });

      expect(result).toBe('success-from-backup');
      expect(failoverSpy).toHaveBeenCalledTimes(1);
      expect(failoverSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          fromEndpoint: 'primary-failing',
          toEndpoint: 'secondary-healthy',
          networkId: 'eip155:1',
        }),
      );
    });

    it('throws AllRpcEndpointsFailedError when all providers are failing', async () => {
      const client = new ResilientRpcClient({
        networkId: 'solana:mainnet-beta',
        retryOptions: { maxRetries: 0 },
        endpoints: [
          { name: 'solana-1', url: 'https://sol1.internal', priority: 1, circuitBreakerOptions: { failureThreshold: 1 } },
          { name: 'solana-2', url: 'https://sol2.internal', priority: 2, circuitBreakerOptions: { failureThreshold: 1 } },
        ],
      });

      await expect(
        client.executeRpc(async () => {
          throw new Error('Down');
        }),
      ).rejects.toThrow(AllRpcEndpointsFailedError);
    });
  });
});

