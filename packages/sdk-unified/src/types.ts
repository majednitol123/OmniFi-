import { EvmClientConfig, EvmSimulationResult, EvmTransactionRequest } from '@omnifi/sdk-evm';
import { SolanaClientConfig } from '@omnifi/sdk-solana';
import { PublicKey, VersionedTransaction } from '@solana/web3.js';
import { Hex } from 'viem';

export interface UnifiedClientConfig {
  evm?: Record<number, EvmClientConfig> | undefined;
  solana?: SolanaClientConfig | undefined;
}

export type UnifiedSwapParams =
  | {
      namespace: 'eip155';
      chainId: number;
      tokenIn: `0x${string}`;
      tokenOut: `0x${string}`;
      amountIn: bigint;
      amountOutMin: bigint;
      recipient: `0x${string}`;
      deadline: bigint;
      routerAddress: `0x${string}`;
      protocol: 'v2' | 'clmm' | 'v4';
      fee?: number | undefined;
      sqrtPriceLimitX96?: bigint | undefined;
    }
  | {
      namespace: 'solana';
      cluster?: 'mainnet-beta' | 'devnet' | 'localnet' | undefined;
      user: PublicKey;
      tokenIn: PublicKey;
      tokenOut: PublicKey;
      amountIn: bigint;
      minimumAmountOut: bigint;
      protocol: 'amm' | 'clmm';
      poolState: PublicKey;
      tokenVault0: PublicKey;
      tokenVault1: PublicKey;
      userSource: PublicKey;
      userDestination: PublicKey;
      zeroForOne: boolean;
      config?: PublicKey | undefined;
      tickArrays?: PublicKey[] | undefined;
      sqrtPriceLimitX64?: bigint | undefined;
      recentBlockhash?: string | undefined;
    };

export type UnifiedPreparedTransaction =
  | {
      namespace: 'eip155';
      chainId: number;
      transaction: EvmTransactionRequest;
    }
  | {
      namespace: 'solana';
      cluster: 'mainnet-beta' | 'devnet' | 'localnet';
      transaction: VersionedTransaction;
    };

export type UnifiedSimulationResult =
  | {
      namespace: 'eip155';
      chainId: number;
      success: boolean;
      gasUsed?: bigint | undefined;
      returnData?: Hex | undefined;
      error?: string | undefined;
    }
  | {
      namespace: 'solana';
      cluster: 'mainnet-beta' | 'devnet' | 'localnet';
      success: boolean;
      unitsConsumed: number;
      logs: readonly string[];
      err: any;
    };
