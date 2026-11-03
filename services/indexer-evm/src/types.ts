import { Hex } from 'viem';

export interface EvmIndexerConfig {
  networkId: string;
  chainId: number;
  rpcUrl: string;
  startBlock?: bigint | undefined;
  batchSize?: number | undefined;
  finalityDepth?: number | undefined;
  pollIntervalMs?: number | undefined;
}

export interface RawLog {
  address: `0x${string}`;
  topics: Hex[];
  data: Hex;
  blockNumber: bigint;
  blockHash: Hex;
  transactionHash: Hex;
  logIndex: number;
}

export type DecodedEvmEvent =
  | {
      type: 'V2_SWAP';
      poolAddress: `0x${string}`;
      sender: `0x${string}`;
      recipient: `0x${string}`;
      amount0In: bigint;
      amount1In: bigint;
      amount0Out: bigint;
      amount1Out: bigint;
      blockNumber: bigint;
      blockHash: Hex;
      txHash: Hex;
      logIndex: number;
    }
  | {
      type: 'V2_SYNC';
      poolAddress: `0x${string}`;
      reserve0: bigint;
      reserve1: bigint;
      blockNumber: bigint;
      blockHash: Hex;
      txHash: Hex;
      logIndex: number;
    }
  | {
      type: 'CLMM_SWAP';
      poolAddress: `0x${string}`;
      sender: `0x${string}`;
      recipient: `0x${string}`;
      amount0: bigint;
      amount1: bigint;
      sqrtPriceX96: bigint;
      liquidity: bigint;
      tick: number;
      blockNumber: bigint;
      blockHash: Hex;
      txHash: Hex;
      logIndex: number;
    };

