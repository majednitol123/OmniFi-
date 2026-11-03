import {
  HealthResponse,
  NetworkSummary,
  TokenResponse,
  PoolSummary,
  PositionSummary,
  QuoteRequest,
  QuoteResponse,
  PrepareSwapRequest,
  PrepareSwapResponse,
  PrepareLiquidityAddRequest,
  PrepareLiquidityRemoveRequest,
  PrepareCollectFeesRequest,
  ApiError,
  ErrorCode,
} from './types';
import { OmniFiApiError } from './errors';

export interface OmniFiClientConfig {
  readonly baseUrl: string;
  readonly fetchFn?: typeof fetch;
}

export class OmniFiClient {
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(config: OmniFiClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    const rawFetch = config.fetchFn || globalThis.fetch;
    this.fetchFn = (input, init) => rawFetch(input, init);
  }

  public async getHealth(): Promise<HealthResponse> {
    return this.request<HealthResponse>('/health');
  }

  public async listNetworks(): Promise<{ networks: readonly NetworkSummary[]; total: number }> {
    return this.request<{ networks: readonly NetworkSummary[]; total: number }>('/api/v1/networks');
  }

  public async listTokens(
    networkId?: string,
    riskTier?: string,
    symbol?: string,
  ): Promise<{ tokens: readonly TokenResponse[]; total: number }> {
    const params = new URLSearchParams();
    if (networkId) params.set('networkId', networkId);
    if (riskTier) params.set('riskTier', riskTier);
    if (symbol) params.set('symbol', symbol);
    const query = params.toString() ? `?${params.toString()}` : '';
    return this.request<{ tokens: readonly TokenResponse[]; total: number }>(`/api/v1/tokens${query}`);
  }

  public async getToken(assetRef: string): Promise<TokenResponse> {
    return this.request<TokenResponse>(`/tokens/${encodeURIComponent(assetRef)}`);
  }

  public async getTokenByNetworkAndAsset(network: string, asset: string): Promise<TokenResponse> {
    return this.request<TokenResponse>(
      `/api/v1/tokens/${encodeURIComponent(network)}/${encodeURIComponent(asset)}`,
    );
  }

  public async listPools(params?: {
    networkId?: string;
    protocol?: string;
    token?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ pools: readonly PoolSummary[]; total: number; offset: number; limit: number }> {
    const searchParams = new URLSearchParams();
    if (params?.networkId) searchParams.set('networkId', params.networkId);
    if (params?.protocol) searchParams.set('protocol', params.protocol);
    if (params?.token) searchParams.set('token', params.token);
    if (params?.limit !== undefined) searchParams.set('limit', params.limit.toString());
    if (params?.offset !== undefined) searchParams.set('offset', params.offset.toString());
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';
    return this.request(`/api/v1/pools${query}`);
  }

  public async getPool(network: string, poolId: string): Promise<PoolSummary> {
    return this.request<PoolSummary>(
      `/api/v1/pools/${encodeURIComponent(network)}/${encodeURIComponent(poolId)}`,
    );
  }

  public async listPositions(params: {
    owner: string;
    networkId?: string;
    poolId?: string;
  }): Promise<{ positions: readonly PositionSummary[]; total: number }> {
    const searchParams = new URLSearchParams();
    searchParams.set('owner', params.owner);
    if (params.networkId) searchParams.set('networkId', params.networkId);
    if (params.poolId) searchParams.set('poolId', params.poolId);
    return this.request(`/api/v1/positions?${searchParams.toString()}`);
  }

  public async getQuote(request: QuoteRequest): Promise<QuoteResponse> {
    return this.request<QuoteResponse>('/quote', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  public async prepareSwap(request: PrepareSwapRequest): Promise<PrepareSwapResponse> {
    return this.request<PrepareSwapResponse>('/api/v1/swap/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  public async prepareAddLiquidity(request: PrepareLiquidityAddRequest): Promise<any> {
    return this.request('/api/v1/liquidity/add/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  public async prepareRemoveLiquidity(request: PrepareLiquidityRemoveRequest): Promise<any> {
    return this.request('/api/v1/liquidity/remove/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  public async prepareCollectFees(request: PrepareCollectFeesRequest): Promise<any> {
    return this.request('/api/v1/positions/collect/prepare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  }

  public async getAnalyticsOverview(networkId?: string): Promise<any> {
    const query = networkId ? `?networkId=${encodeURIComponent(networkId)}` : '';
    return this.request(`/api/v1/analytics/overview${query}`);
  }

  public async getPoolAnalytics(network: string, poolId: string): Promise<any> {
    return this.request(
      `/api/v1/analytics/pools/${encodeURIComponent(network)}/${encodeURIComponent(poolId)}`,
    );
  }

  private async request<T>(path: string, options?: RequestInit): Promise<T> {
    const url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    try {
      const response = await this.fetchFn(url, options);
      const json = (await response.json()) as any;

      if (!response.ok) {
        const errorMsg =
          json?.detail ||
          json?.message ||
          json?.title ||
          json?.error ||
          (response.statusText ? `HTTP ${response.status}: ${response.statusText}` : 'API request failed');

        throw new OmniFiApiError(
          errorMsg,
          json?.code || ErrorCode.INTERNAL_ERROR,
          response.status,
          json?.details,
          json?.userMessage || errorMsg,
        );
      }

      return json as T;
    } catch (error) {
      if (error instanceof OmniFiApiError) {
        throw error;
      }
      throw new OmniFiApiError(
        (error as Error).message || 'Network error',
        ErrorCode.RPC_UNAVAILABLE,
        0,
      );
    }
  }
}
