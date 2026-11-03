import { CircuitBreaker, CircuitBreakerOptions, CircuitState } from './circuit-breaker';
import { calculateBackoffWithJitter, isRetryableError, RetryOptions } from './retry-strategy';

export interface RpcEndpointConfig {
  readonly name: string;
  readonly url: string;
  readonly priority: number; // lower number = higher preference (e.g. 1 = primary, 2 = secondary)
  readonly circuitBreakerOptions?: CircuitBreakerOptions | undefined;
}

export interface FailoverEvent {
  readonly networkId: string;
  readonly fromEndpoint: string;
  readonly toEndpoint: string;
  readonly reason: string;
  readonly timestamp: number;
}

export interface ResilientRpcClientOptions {
  readonly networkId: string;
  readonly endpoints: readonly RpcEndpointConfig[];
  readonly retryOptions?: RetryOptions | undefined;
  readonly onFailover?: ((event: FailoverEvent) => void) | undefined;
}

export interface EndpointHealthStatus {
  readonly name: string;
  readonly url: string;
  readonly priority: number;
  readonly state: CircuitState;
  readonly consecutiveFailures: number;
}

export class AllRpcEndpointsFailedError extends Error {
  constructor(networkId: string, details: string) {
    super(`All RPC endpoints for network '${networkId}' are degraded or failing: ${details}`);
    this.name = 'AllRpcEndpointsFailedError';
  }
}

export class ResilientRpcClient {
  private readonly networkId: string;
  private readonly endpoints: { config: RpcEndpointConfig; circuitBreaker: CircuitBreaker }[];
  private readonly retryOptions: RetryOptions;
  private readonly onFailover?: ((event: FailoverEvent) => void) | undefined;
  private activeEndpointIndex = 0;

  constructor(options: ResilientRpcClientOptions) {
    if (!options.endpoints || options.endpoints.length === 0) {
      throw new Error(`ResilientRpcClient requires at least one endpoint for network ${options.networkId}`);
    }

    this.networkId = options.networkId;
    this.retryOptions = options.retryOptions ?? {};
    this.onFailover = options.onFailover;

    // Sort endpoints by priority ascending (1 before 2)
    const sorted = [...options.endpoints].sort((a, b) => a.priority - b.priority);
    this.endpoints = sorted.map((config) => ({
      config,
      circuitBreaker: new CircuitBreaker(config.circuitBreakerOptions),
    }));
  }

  public getNetworkId(): string {
    return this.networkId;
  }

  public getActiveEndpoint(): RpcEndpointConfig {
    const ep = this.endpoints[this.activeEndpointIndex];
    return ep ? ep.config : this.endpoints[0]!.config;
  }

  public getHealthStatus(): EndpointHealthStatus[] {
    return this.endpoints.map(({ config, circuitBreaker }) => {
      const stats = circuitBreaker.getStats();
      return {
        name: config.name,
        url: config.url,
        priority: config.priority,
        state: stats.state,
        consecutiveFailures: stats.consecutiveFailures,
      };
    });
  }

  /**
   * Executes an RPC call through the current active endpoint with automated circuit breaker
   * tracking, retry backoff with jitter, and failover to secondary endpoints upon failure.
   */
  public async executeRpc<T>(callFn: (url: string) => Promise<T>): Promise<T> {
    const maxRetries = this.retryOptions.maxRetries ?? 2;
    const errors: string[] = [];

    // Try starting from current active or lowest priority healthy endpoint
    for (let epIndex = 0; epIndex < this.endpoints.length; epIndex++) {
      // Find candidate endpoint
      const candidateIndex = (this.activeEndpointIndex + epIndex) % this.endpoints.length;
      const target = this.endpoints[candidateIndex]!;

      if (!target.circuitBreaker.canExecute()) {
        errors.push(`${target.config.name} (${target.config.url}): circuit breaker OPEN`);
        continue;
      }

      // If we are failing over to a new endpoint, notify
      if (candidateIndex !== this.activeEndpointIndex) {
        const prev = this.endpoints[this.activeEndpointIndex]!.config;
        this.activeEndpointIndex = candidateIndex;
        this.onFailover?.({
          networkId: this.networkId,
          fromEndpoint: prev.name,
          toEndpoint: target.config.name,
          reason: errors[errors.length - 1] || 'Prior endpoint circuit breaker OPEN',
          timestamp: Date.now(),
        });
      }

      // Attempt execution on target endpoint with retries
      let lastEndpointError: any = null;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          const result = await callFn(target.config.url);
          target.circuitBreaker.recordSuccess();
          return result;
        } catch (err: any) {
          lastEndpointError = err;
          const retryable = isRetryableError(err);

          if (retryable && attempt < maxRetries) {
            const delayMs = calculateBackoffWithJitter(attempt, this.retryOptions);
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          } else {
            break;
          }
        }
      }

      // Endpoint failed all attempts
      target.circuitBreaker.recordFailure();
      errors.push(`${target.config.name}: ${lastEndpointError?.message || 'Execution error'}`);
    }

    throw new AllRpcEndpointsFailedError(this.networkId, errors.join('; '));
  }
}
