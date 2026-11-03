export interface DbNetwork {
  networkId: string;
  name: string;
  namespace: 'eip155' | 'solana';
  chainRef: string;
  nativeAssetSymbol: string;
  nativeAssetDecimals: number;
  status: 'active' | 'degraded' | 'maintenance';
  createdAt: Date;
}

export interface DbToken {
  tokenId: string;
  networkId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  riskTier: 'LOW' | 'MEDIUM' | 'HIGH';
  logoUri?: string | undefined;
  createdAt: Date;
}

export interface DbPool {
  poolId: string;
  networkId: string;
  protocol: 'v2' | 'clmm' | 'v4' | 'amm';
  token0Id: string;
  token1Id: string;
  feeTier: number;
  tickSpacing?: number | undefined;
  reserve0?: bigint | undefined;
  reserve1?: bigint | undefined;
  sqrtPriceX64?: bigint | undefined;
  currentTick?: number | undefined;
  liquidity?: bigint | undefined;
  protocolFeeFraction?: number | undefined;
  isPaused: boolean;
  createdAt: Date;
}

export interface DbSwap {
  swapId: string;
  networkId: string;
  poolId: string;
  txHash: string;
  blockNumberOrSlot: bigint;
  blockTimestamp: Date;
  sender: string;
  recipient: string;
  amount0In: bigint;
  amount1In: bigint;
  amount0Out: bigint;
  amount1Out: bigint;
  sqrtPriceAfter?: bigint | undefined;
  tickAfter?: number | undefined;
  eventIndex: number;
  finalized: boolean;
  createdAt: Date;
}

export interface DbLiquidityPosition {
  positionId: string;
  networkId: string;
  poolId: string;
  owner: string;
  onchainPositionId: string;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  tokensOwed0: bigint;
  tokensOwed1: bigint;
  status: 'OPEN' | 'CLOSED';
  updatedAt: Date;
}

export interface DbPositionEvent {
  eventId: string;
  positionId: string;
  eventType: 'MINT' | 'INCREASE' | 'DECREASE' | 'COLLECT' | 'BURN';
  liquidityDelta: bigint;
  amount0: bigint;
  amount1: bigint;
  txHash: string;
  blockNumberOrSlot: bigint;
  eventIndex: number;
  createdAt: Date;
}

export interface DbChainEvent {
  eventId: string;
  networkId: string;
  txHash: string;
  logIndex: number;
  blockNumberOrSlot: bigint;
  blockHash?: string | undefined;
  eventName: string;
  payload: Record<string, any>;
  finalized: boolean;
  createdAt: Date;
}

export interface DbIndexerCheckpoint {
  networkId: string;
  lastScannedBlockOrSlot: bigint;
  lastFinalizedBlockOrSlot: bigint;
  lastBlockHash?: string | undefined;
  updatedAt: Date;
}

export interface DbIndexerReorg {
  reorgId: string;
  networkId: string;
  forkBlockOrSlot: bigint;
  commonAncestorBlock: bigint;
  eventsRolledBack: number;
  detectedAt: Date;
}

export interface DbReconciliationRun {
  runId: string;
  networkId: string;
  poolId: string;
  onchainReserve0: bigint;
  dbReserve0: bigint;
  drift0: bigint;
  onchainReserve1: bigint;
  dbReserve1: bigint;
  drift1: bigint;
  status: 'OK' | 'DRIFT_DETECTED';
  auditedAt: Date;
}

export interface DbAuditLog {
  logId: string;
  source: string;
  action: string;
  details: Record<string, any>;
  timestamp: Date;
}

