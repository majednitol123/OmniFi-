export interface RetryOptions {
  readonly maxRetries?: number; // default: 3
  readonly baseDelayMs?: number; // default: 200
  readonly maxDelayMs?: number; // default: 2000
  readonly jitterFactor?: number; // default: 0.2 (20%)
}

export function isRetryableError(error: any): boolean {
  if (!error) return false;

  const msg = (error.message || '').toLowerCase();
  const status = error.status || error.statusCode || error.response?.status;

  // Rate limiting & server side transient issues
  if (status === 429 || status === 502 || status === 503 || status === 504) {
    return true;
  }

  // Common network drop / timeout errors
  if (
    msg.includes('rate limit') ||
    msg.includes('429') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('econnrefused') ||
    msg.includes('fetch failed') ||
    msg.includes('network error') ||
    msg.includes('etimedout')
  ) {
    return true;
  }

  return false;
}

export function calculateBackoffWithJitter(
  attempt: number,
  options: RetryOptions = {},
): number {
  const baseDelay = options.baseDelayMs ?? 200;
  const maxDelay = options.maxDelayMs ?? 2000;
  const jitterFactor = options.jitterFactor ?? 0.2;

  const exponential = baseDelay * Math.pow(2, attempt);
  const capped = Math.min(maxDelay, exponential);
  const jitter = capped * jitterFactor * (Math.random() * 2 - 1); // +/- 20%
  return Math.max(10, Math.floor(capped + jitter));
}

