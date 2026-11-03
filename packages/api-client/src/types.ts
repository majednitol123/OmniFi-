import { ErrorCode, ApiError } from './errors';

export interface HealthResponse {
  readonly status: 'ok' | 'degraded' | 'maintenance' | 'healthy';
  readonly timestamp: string | number;
  readonly version?: string | undefined;
}

export interface NetworkSummary {
  readonly networkId: string;
  readonly name: string;
  readonly namespace: 'eip155' | 'solana';
  readonly chainRef: string;
  readonly nativeAsset: {
    readonly symbol: string;
    readonly decimals: number;
  };
  readonly rpcUrl: string;
  readonly status: 'active' | 'degraded' | 'maintenance';
}

export interface TokenResponse {
  readonly networkId: string;
  readonly address: string;
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
  readonly riskTier: string;
  readonly logoUri?: string | undefined;
}

export interface PoolSummary {
  readonly poolId: string;
  readonly networkId: string;
  readonly namespace: string;
  readonly chainRef: string;
  readonly poolType: string;
  readonly token0: any;
  readonly token1: any;
  readonly feeTier: number;
  readonly state: any;
}

export interface PositionSummary {
  readonly positionId: string;
  readonly networkId: string;
  readonly namespace: string;
  readonly poolId: string;
  readonly owner: string;
  readonly token0: string;
  readonly token1: string;
  readonly feeTier: number;
  readonly tickLower: number;
  readonly tickUpper: number;
  readonly liquidity: string;
  readonly tokensOwed0: string;
  readonly tokensOwed1: string;
}

export interface QuoteRequest {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amount: string; // Decimal integer string
  readonly exactIn: boolean;
}

export interface QuoteResponse {
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string; // Decimal integer string
  readonly amountOut: string; // Decimal integer string
  readonly executionPrice: string;
  readonly priceImpactBps: number;
  readonly estimatedGasOrFee: string;
}

export interface PrepareSwapRequest {
  readonly namespace: 'eip155' | 'solana';
  readonly networkId: string;
  readonly userAddress: string;
  readonly protocol: 'v2' | 'clmm' | 'v4' | 'amm';
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly amountIn: string;
  readonly minAmountOut: string;
  readonly recipient?: string | undefined;
  readonly deadline?: string | undefined;
  readonly routerAddress?: string | undefined;
}

export interface PrepareSwapResponse {
  readonly namespace: 'eip155' | 'solana';
  readonly networkId: string;
  readonly userAddress: string;
  readonly preparedTransaction: any;
  readonly metadata: any;
}

export interface PrepareLiquidityAddRequest {
  readonly namespace: 'eip155' | 'solana';
  readonly networkId: string;
  readonly userAddress: string;
  readonly protocol: 'v2' | 'clmm' | 'v4' | 'amm';
  readonly token0: string;
  readonly token1: string;
  readonly amount0Desired: string;
  readonly amount1Desired: string;
  readonly amount0Min: string;
  readonly amount1Min: string;
  readonly tickLower?: number | undefined;
  readonly tickUpper?: number | undefined;
  readonly feeTier?: number | undefined;
}

export interface PrepareLiquidityRemoveRequest {
  readonly namespace: 'eip155' | 'solana';
  readonly networkId: string;
  readonly userAddress: string;
  readonly protocol: 'v2' | 'clmm' | 'v4' | 'amm';
  readonly poolId: string;
  readonly positionId?: string | undefined;
  readonly liquidity: string;
  readonly amount0Min: string;
  readonly amount1Min: string;
}

export interface PrepareCollectFeesRequest {
  readonly namespace: 'eip155' | 'solana';
  readonly networkId: string;
  readonly owner: string;
  readonly poolId: string;
  readonly positionId: string;
  readonly recipient?: string | undefined;
}

export { ErrorCode, ApiError };
