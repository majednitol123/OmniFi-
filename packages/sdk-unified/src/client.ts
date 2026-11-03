import { OmniFiEvmClient } from '@omnifi/sdk-evm';
import { OmniFiSolanaClient } from '@omnifi/sdk-solana';
import {
  UnifiedClientConfig,
  UnifiedPreparedTransaction,
  UnifiedSimulationResult,
  UnifiedSwapParams,
} from './types';

export class OmniFiUnifiedClient {
  private readonly evmClients = new Map<number, OmniFiEvmClient>();
  private readonly solanaClient?: OmniFiSolanaClient | undefined;

  constructor(config: UnifiedClientConfig) {
    if (config.evm) {
      for (const [chainIdStr, evmConfig] of Object.entries(config.evm)) {
        const chainId = Number(chainIdStr);
        this.evmClients.set(chainId, new OmniFiEvmClient(evmConfig));
      }
    }

    if (config.solana) {
      this.solanaClient = new OmniFiSolanaClient(config.solana);
    }
  }

  public evm(chainId: number): OmniFiEvmClient {
    const client = this.evmClients.get(chainId);
    if (!client) {
      throw new Error(`EVM client not configured for chainId: ${chainId}`);
    }
    return client;
  }

  public solana(): OmniFiSolanaClient {
    if (!this.solanaClient) {
      throw new Error('Solana client not configured');
    }
    return this.solanaClient;
  }

  public async prepareSwap(params: UnifiedSwapParams): Promise<UnifiedPreparedTransaction> {
    if (params.namespace === 'eip155') {
      const client = this.evm(params.chainId);

      if (params.protocol === 'v2') {
        const tx = client.buildV2SwapTransaction({
          routerAddress: params.routerAddress,
          amountIn: params.amountIn,
          amountOutMin: params.amountOutMin,
          path: [params.tokenIn, params.tokenOut],
          recipient: params.recipient,
          deadline: params.deadline,
        });

        return {
          namespace: 'eip155',
          chainId: params.chainId,
          transaction: tx,
        };
      }

      if (params.protocol === 'clmm') {
        const tx = client.buildClmmSingleSwapTransaction({
          routerAddress: params.routerAddress,
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          fee: params.fee ?? 3000,
          recipient: params.recipient,
          deadline: params.deadline,
          amountIn: params.amountIn,
          amountOutMinimum: params.amountOutMin,
          sqrtPriceLimitX96: params.sqrtPriceLimitX96,
        });

        return {
          namespace: 'eip155',
          chainId: params.chainId,
          transaction: tx,
        };
      }

      throw new Error(`Protocol ${params.protocol} preparation not supported directly on EVM`);
    }

    if (params.namespace === 'solana') {
      const client = this.solana();
      const cluster = params.cluster ?? 'mainnet-beta';

      if (params.protocol === 'amm') {
        const tx = await client.buildAmmSwapTransaction({
          user: params.user,
          poolState: params.poolState,
          tokenVault0: params.tokenVault0,
          tokenVault1: params.tokenVault1,
          userSource: params.userSource,
          userDestination: params.userDestination,
          amountIn: params.amountIn,
          minimumAmountOut: params.minimumAmountOut,
          zeroForOne: params.zeroForOne,
          recentBlockhash: params.recentBlockhash,
        });

        return {
          namespace: 'solana',
          cluster,
          transaction: tx,
        };
      }

      if (params.protocol === 'clmm') {
        if (!params.config) {
          throw new Error('CLMM swap requires config pubkey');
        }

        const tx = await client.buildClmmSwapTransaction({
          user: params.user,
          config: params.config,
          poolState: params.poolState,
          tokenVault0: params.tokenVault0,
          tokenVault1: params.tokenVault1,
          userSource: params.userSource,
          userDestination: params.userDestination,
          tickArrays: params.tickArrays ?? [],
          amount: params.amountIn,
          otherAmountThreshold: params.minimumAmountOut,
          sqrtPriceLimitX64: params.sqrtPriceLimitX64 ?? 0n,
          isExactInput: true,
          zeroForOne: params.zeroForOne,
          recentBlockhash: params.recentBlockhash,
        });

        return {
          namespace: 'solana',
          cluster,
          transaction: tx,
        };
      }

      throw new Error(`Protocol ${(params as any).protocol} not supported on Solana`);
    }

    throw new Error(`Unsupported namespace: ${(params as any).namespace}`);
  }

  public async simulate(
    prepared: UnifiedPreparedTransaction,
    callerAddress?: string | undefined,
  ): Promise<UnifiedSimulationResult> {
    if (prepared.namespace === 'eip155') {
      const client = this.evm(prepared.chainId);
      const from =
        (callerAddress as `0x${string}` | undefined) ??
        '0x0000000000000000000000000000000000000001';
      const res = await client.simulate(from, prepared.transaction);
      return {
        namespace: 'eip155',
        chainId: prepared.chainId,
        success: res.success,
        gasUsed: res.gasUsed,
        returnData: res.returnData,
        error: res.error,
      };
    }

    if (prepared.namespace === 'solana') {
      const client = this.solana();
      const sim = await client.simulateTransaction(prepared.transaction);
      return {
        namespace: 'solana',
        cluster: prepared.cluster,
        success: sim.err === null,
        unitsConsumed: sim.unitsConsumed ?? 0,
        logs: sim.logs ?? [],
        err: sim.err,
      };
    }

    throw new Error(`Unsupported namespace: ${(prepared as any).namespace}`);
  }
}
