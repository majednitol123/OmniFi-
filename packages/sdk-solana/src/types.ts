import { PublicKey } from '@solana/web3.js';
import { FeeTier } from './constants';

export interface GlobalConfigAccount {
  authority: PublicKey;
  feeAuthority: PublicKey;
  protocolFeeFraction: number;
  emergencyPaused: boolean;
  bump: number;
}

export interface PoolStateAccount {
  config: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  lpMint: PublicKey;
  feeTier: FeeTier;
  reserve0: bigint;
  reserve1: bigint;
  lpSupply: bigint;
  protocolFees0: bigint;
  protocolFees1: bigint;
  bump: number;
  authorityBump: number;
  isPaused: boolean;
}

export interface SwapQuoteParams {
  amountIn?: bigint;
  amountOut?: bigint;
  reserveIn: bigint;
  reserveOut: bigint;
  feeTier: number;
  protocolFeeFraction?: number;
}

export interface SwapQuoteResult {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  protocolFeeAmount: bigint;
  priceImpactBps: number;
}

// ---------------------------------------------------------
// CLMM (Concentrated Liquidity) Types
// ---------------------------------------------------------

export interface ClmmGlobalConfigAccount {
  authority: PublicKey;
  feeAuthority: PublicKey;
  defaultProtocolFeeFraction: number;
  emergencyPaused: boolean;
  bump: number;
}

export interface ClmmPoolState {
  config: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  feeTier: number;
  tickSpacing: number;
  sqrtPriceX64: bigint;
  currentTick: number;
  liquidity: bigint;
  feeGrowthGlobal0X64: bigint;
  feeGrowthGlobal1X64: bigint;
  protocolFees0: bigint;
  protocolFees1: bigint;
  bump: number;
  authorityBump: number;
  isPaused: boolean;
}

export interface Tick {
  initialized: boolean;
  liquidityGross: bigint;
  liquidityNet: bigint;
  feeGrowthOutside0X64: bigint;
  feeGrowthOutside1X64: bigint;
}

export interface TickArrayAccount {
  pool: PublicKey;
  startTickIndex: number;
  bump: number;
  ticks: Tick[];
}

export interface PositionAccount {
  pool: PublicKey;
  owner: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: bigint;
  feeGrowthInside0LastX64: bigint;
  feeGrowthInside1LastX64: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  bump: number;
}

export interface ClmmSwapQuoteParams {
  sqrtPriceCurrentX64: bigint;
  currentTick: number;
  liquidity: bigint;
  amount: bigint;
  feeTier: number;
  tickSpacing: number;
  zeroForOne: boolean;
  isExactInput: boolean;
  sqrtPriceLimitX64?: bigint;
  tickArrays?: Map<number, TickArrayAccount>;
}

export interface ClmmSwapQuote {
  amountIn: bigint;
  amountOut: bigint;
  feeAmount: bigint;
  sqrtPriceAfterX64: bigint;
  tickAfter: number;
  crossedTicks: number[];
  priceImpactBps: number;
}
