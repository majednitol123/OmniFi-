import { describe, expect, it } from 'vitest';
import { ExpiryTracker } from '../freshness/expiry-tracker';

describe('ExpiryTracker', () => {
  it('creates 15s expiry window by default', () => {
    const before = Date.now();
    const expiry = ExpiryTracker.createExpiry();
    const after = Date.now();

    expect(expiry.ttlMs).toBe(15_000);
    expect(expiry.expiresAt).toBeGreaterThanOrEqual(before + 15_000);
    expect(expiry.expiresAt).toBeLessThanOrEqual(after + 15_000);
  });

  it('correctly reports expiration status and remaining time', () => {
    const now = 1_000_000;
    const futureExpiry = now + 5000;
    const pastExpiry = now - 1000;

    expect(ExpiryTracker.isExpired(futureExpiry, now)).toBe(false);
    expect(ExpiryTracker.remainingTtlMs(futureExpiry, now)).toBe(5000);

    expect(ExpiryTracker.isExpired(pastExpiry, now)).toBe(true);
    expect(ExpiryTracker.remainingTtlMs(pastExpiry, now)).toBe(0);
  });
});

