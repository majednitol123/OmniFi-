export const DEFAULT_QUOTE_TTL_MS = 15_000; // 15 seconds

export interface QuoteExpiry {
  expiresAt: number;
  ttlMs: number;
}

export class ExpiryTracker {
  public static createExpiry(ttlMs: number = DEFAULT_QUOTE_TTL_MS): QuoteExpiry {
    const now = Date.now();
    return {
      expiresAt: now + ttlMs,
      ttlMs,
    };
  }

  public static isExpired(expiresAt: number, now: number = Date.now()): boolean {
    return now >= expiresAt;
  }

  public static remainingTtlMs(expiresAt: number, now: number = Date.now()): number {
    return Math.max(0, expiresAt - now);
  }
}

