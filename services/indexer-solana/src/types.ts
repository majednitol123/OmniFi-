import { Commitment, PublicKey } from '@solana/web3.js';

export interface SolanaIndexerConfig {
  networkId: string;
  cluster: 'mainnet-beta' | 'devnet' | 'localnet';
  rpcUrl: string;
  ammProgramId: PublicKey;
  clmmProgramId: PublicKey;
  commitment?: Commitment | undefined;
  pollIntervalMs?: number | undefined;
  batchSize?: number | undefined;
}

export interface SolanaRawTransaction {
  signature: string;
  slot: bigint;
  blockTime: number;
  err: any;
  logs: string[];
  accounts: string[];
}

export type DecodedSolanaEvent =
  | {
      type: 'AMM_SWAP';
      poolAddress: string;
      user: string;
      amountIn: bigint;
      amountOut: bigint;
      zeroForOne: boolean;
      slot: bigint;
      signature: string;
      logIndex: number;
    }
  | {
      type: 'CLMM_SWAP';
      poolAddress: string;
      user: string;
      amountIn: bigint;
      amountOut: bigint;
      sqrtPriceAfterX64: bigint;
      tickAfter: number;
      zeroForOne: boolean;
      slot: bigint;
      signature: string;
      logIndex: number;
    }
  | {
      type: 'CLMM_POSITION_UPDATE';
      poolAddress: string;
      owner: string;
      positionAddress: string;
      tickLower: number;
      tickUpper: number;
      liquidityDelta: bigint;
      slot: bigint;
      signature: string;
      logIndex: number;
    };

