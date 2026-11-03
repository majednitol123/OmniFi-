import { Hex } from 'viem';

export interface EvmClientConfig {
  rpcUrl: string;
  chainId: number;
}

export interface V2PairReserves {
  reserve0: bigint;
  reserve1: bigint;
  blockTimestampLast: number;
}

export interface ClmmSlot0 {
  sqrtPriceX96: bigint;
  tick: number;
  observationIndex: number;
  observationCardinality: number;
  observationCardinalityNext: number;
  feeProtocol: number;
  unlocked: boolean;
}

export interface ClmmPoolState {
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  slot0: ClmmSlot0;
  liquidity: bigint;
  feeGrowthGlobal0X128: bigint;
  feeGrowthGlobal1X128: bigint;
}

export interface ClmmPosition {
  tokenId: bigint;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
}

export interface V4Slot0 {
  sqrtPriceX96: bigint;
  tick: number;
  protocolFee: number;
  lpFee: number;
}

export interface EvmTransactionRequest {
  to: `0x${string}`;
  data: Hex;
  value?: bigint | undefined;
  gasLimit?: bigint | undefined;
}

export interface EvmSimulationResult {
  success: boolean;
  gasUsed?: bigint | undefined;
  returnData?: Hex | undefined;
  error?: string | undefined;
}

export interface V2SwapParams {
  routerAddress: `0x${string}`;
  amountIn: bigint;
  amountOutMin: bigint;
  path: `0x${string}`[];
  recipient: `0x${string}`;
  deadline: bigint;
}

export interface ClmmSingleSwapParams {
  routerAddress: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  recipient: `0x${string}`;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint | undefined;
}

export interface ClmmMintPositionParams {
  positionManagerAddress: `0x${string}`;
  token0: `0x${string}`;
  token1: `0x${string}`;
  fee: number;
  tickLower: number;
  tickUpper: number;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
  recipient: `0x${string}`;
  deadline: bigint;
}

export interface ClmmCollectFeesParams {
  positionManagerAddress: `0x${string}`;
  tokenId: bigint;
  recipient: `0x${string}`;
  amount0Max?: bigint | undefined;
  amount1Max?: bigint | undefined;
}

