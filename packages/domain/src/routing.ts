import { AssetRef, ChainNamespace } from './asset-ref';

export type PoolType = 'v2' | 'v3' | 'v4' | 'solana_amm' | 'solana_clmm';

export interface PoolRef {
  readonly poolId: string;
  readonly namespace: ChainNamespace;
  readonly chainRef: string;
  readonly poolType: PoolType;
  readonly token0: AssetRef;
  readonly token1: AssetRef;
  readonly feeTier: number;
  readonly tickSpacing?: number;
  readonly state: unknown;
}

export interface RouteHop {
  readonly pool: PoolRef;
  readonly tokenIn: AssetRef;
  readonly tokenOut: AssetRef;
  readonly feeTier: number;
}

export interface FeeBreakdown {
  readonly hopIndex: number;
  readonly poolId: string;
  readonly feeTier: number;
  readonly feeAmount: bigint;
  readonly protocolFeeAmount: bigint;
}

export type PriceImpactLevel = 'low' | 'medium' | 'high' | 'critical';

export interface PriceImpact {
  readonly bps: number;
  readonly percentage: string;
  readonly level: PriceImpactLevel;
}

export function computePriceImpactLevel(bps: number): PriceImpactLevel {
  if (bps < 100) return 'low';
  if (bps <= 300) return 'medium';
  if (bps <= 500) return 'high';
  return 'critical';
}

export function createPriceImpact(bps: number): PriceImpact {
  const clampedBps = Math.max(0, bps);
  const percentage = `${(clampedBps / 100).toFixed(2)}%`;
  const level = computePriceImpactLevel(clampedBps);
  return {
    bps: clampedBps,
    percentage,
    level,
  };
}

export interface Route {
  readonly routeId: string;
  readonly hops: RouteHop[];
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly priceImpact: PriceImpact;
  readonly feeBreakdowns: FeeBreakdown[];
}

export interface RouteSplit {
  readonly routeIndex: number;
  readonly percentage: number;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
}

export interface SwapQuote {
  readonly quoteId: string;
  readonly namespace: ChainNamespace;
  readonly chainRef: string;
  readonly tokenIn: AssetRef;
  readonly tokenOut: AssetRef;
  readonly amountIn: bigint;
  readonly amountOut: bigint;
  readonly executionPrice: string;
  readonly priceImpact: PriceImpact;
  readonly routes: Route[];
  readonly splits?: RouteSplit[];
  readonly expiresAt: number;
  readonly ttlMs: number;
}

export interface SolanaAccountMetaPayload {
  pubkey: string;
  isSigner: boolean;
  isWritable: boolean;
}

export interface SolanaInstructionPayload {
  programId: string;
  keys: SolanaAccountMetaPayload[];
  data: string; // base64 string
}

export interface TransactionIntent {
  readonly intentId: string;
  readonly quoteId: string;
  readonly namespace: ChainNamespace;
  readonly chainRef: string;
  readonly to: string;
  readonly data?: string; // 0x hex for EVM
  readonly value?: string; // wei integer string for EVM native transfer
  readonly instructions?: SolanaInstructionPayload[];
  readonly estimatedGas?: bigint;
  readonly estimatedComputeUnits?: number;
  readonly simulationSuccess: boolean;
  readonly simulationError?: string;
}

