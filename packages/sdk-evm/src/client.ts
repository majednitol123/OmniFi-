import {
  createPublicClient,
  encodeFunctionData,
  Hex,
  http,
  PublicClient,
} from 'viem';
import {
  CLMM_POOL_ABI,
  CLMM_POSITION_MANAGER_ABI,
  CLMM_SWAP_ROUTER_ABI,
  ERC20_ABI,
  V2_PAIR_ABI,
  V2_ROUTER_ABI,
  V4_POOL_MANAGER_ABI,
} from './abi';
import {
  ClmmCollectFeesParams,
  ClmmMintPositionParams,
  ClmmPoolState,
  ClmmPosition,
  ClmmSingleSwapParams,
  EvmClientConfig,
  EvmSimulationResult,
  EvmTransactionRequest,
  V2PairReserves,
  V2SwapParams,
  V4Slot0,
} from './types';

export class OmniFiEvmClient {
  public readonly publicClient: PublicClient;
  public readonly config: EvmClientConfig;

  constructor(config: EvmClientConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    }) as PublicClient;
  }

  // -------------------------------------------------------------
  // On-Chain State Queries
  // -------------------------------------------------------------

  public async getV2PairReserves(pairAddress: `0x${string}`): Promise<V2PairReserves> {
    const data = await this.publicClient.readContract({
      address: pairAddress,
      abi: V2_PAIR_ABI,
      functionName: 'getReserves',
    });

    return {
      reserve0: BigInt(data[0]),
      reserve1: BigInt(data[1]),
      blockTimestampLast: Number(data[2]),
    };
  }

  public async getClmmPoolState(poolAddress: `0x${string}`): Promise<ClmmPoolState> {
    const [token0, token1, fee, tickSpacing, slot0Data, liquidity, feeGrowth0, feeGrowth1] =
      await Promise.all([
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'token0',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'token1',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'fee',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'tickSpacing',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'slot0',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'liquidity',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'feeGrowthGlobal0X128',
        }),
        this.publicClient.readContract({
          address: poolAddress,
          abi: CLMM_POOL_ABI,
          functionName: 'feeGrowthGlobal1X128',
        }),
      ]);

    return {
      token0,
      token1,
      fee: Number(fee),
      tickSpacing: Number(tickSpacing),
      slot0: {
        sqrtPriceX96: BigInt(slot0Data[0]),
        tick: Number(slot0Data[1]),
        observationIndex: Number(slot0Data[2]),
        observationCardinality: Number(slot0Data[3]),
        observationCardinalityNext: Number(slot0Data[4]),
        feeProtocol: Number(slot0Data[5]),
        unlocked: slot0Data[6],
      },
      liquidity: BigInt(liquidity),
      feeGrowthGlobal0X128: BigInt(feeGrowth0),
      feeGrowthGlobal1X128: BigInt(feeGrowth1),
    };
  }

  public async getClmmPosition(
    positionManagerAddress: `0x${string}`,
    tokenId: bigint,
  ): Promise<ClmmPosition> {
    const data = await this.publicClient.readContract({
      address: positionManagerAddress,
      abi: CLMM_POSITION_MANAGER_ABI,
      functionName: 'positions',
      args: [tokenId],
    });

    return {
      tokenId,
      token0: data[2],
      token1: data[3],
      fee: Number(data[4]),
      tickLower: Number(data[5]),
      tickUpper: Number(data[6]),
      liquidity: BigInt(data[7]),
      tokensOwed0: BigInt(data[10]),
      tokensOwed1: BigInt(data[11]),
    };
  }

  public async getV4PoolSlot0(
    poolManagerAddress: `0x${string}`,
    poolId: Hex,
  ): Promise<V4Slot0> {
    const data = await this.publicClient.readContract({
      address: poolManagerAddress,
      abi: V4_POOL_MANAGER_ABI,
      functionName: 'getSlot0',
      args: [poolId],
    });

    return {
      sqrtPriceX96: BigInt(data[0]),
      tick: Number(data[1]),
      protocolFee: Number(data[2]),
      lpFee: Number(data[3]),
    };
  }

  public async getTokenBalance(
    tokenAddress: `0x${string}`,
    ownerAddress: `0x${string}`,
  ): Promise<bigint> {
    const bal = await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [ownerAddress],
    });
    return BigInt(bal);
  }

  public async getAllowance(
    tokenAddress: `0x${string}`,
    ownerAddress: `0x${string}`,
    spenderAddress: `0x${string}`,
  ): Promise<bigint> {
    const allow = await this.publicClient.readContract({
      address: tokenAddress,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [ownerAddress, spenderAddress],
    });
    return BigInt(allow);
  }

  // -------------------------------------------------------------
  // Transaction Builders (Unsigned Requests)
  // -------------------------------------------------------------

  public buildApproveTransaction(
    tokenAddress: `0x${string}`,
    spenderAddress: `0x${string}`,
    amount: bigint = (1n << 256n) - 1n,
  ): EvmTransactionRequest {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [spenderAddress, amount],
    });

    return {
      to: tokenAddress,
      data,
      value: 0n,
    };
  }

  public buildV2SwapTransaction(params: V2SwapParams): EvmTransactionRequest {
    const data = encodeFunctionData({
      abi: V2_ROUTER_ABI,
      functionName: 'swapExactTokensForTokens',
      args: [
        params.amountIn,
        params.amountOutMin,
        params.path,
        params.recipient,
        params.deadline,
      ],
    });

    return {
      to: params.routerAddress,
      data,
      value: 0n,
    };
  }

  public buildClmmSingleSwapTransaction(params: ClmmSingleSwapParams): EvmTransactionRequest {
    const data = encodeFunctionData({
      abi: CLMM_SWAP_ROUTER_ABI,
      functionName: 'exactInputSingle',
      args: [
        {
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          fee: params.fee,
          recipient: params.recipient,
          deadline: params.deadline,
          amountIn: params.amountIn,
          amountOutMinimum: params.amountOutMinimum,
          sqrtPriceLimitX96: params.sqrtPriceLimitX96 ?? 0n,
        },
      ],
    });

    return {
      to: params.routerAddress,
      data,
      value: 0n,
    };
  }

  public buildClmmMintPositionTransaction(params: ClmmMintPositionParams): EvmTransactionRequest {
    const data = encodeFunctionData({
      abi: CLMM_POSITION_MANAGER_ABI,
      functionName: 'mint',
      args: [
        {
          token0: params.token0,
          token1: params.token1,
          fee: params.fee,
          tickLower: params.tickLower,
          tickUpper: params.tickUpper,
          amount0Desired: params.amount0Desired,
          amount1Desired: params.amount1Desired,
          amount0Min: params.amount0Min,
          amount1Min: params.amount1Min,
          recipient: params.recipient,
          deadline: params.deadline,
        },
      ],
    });

    return {
      to: params.positionManagerAddress,
      data,
      value: 0n,
    };
  }

  public buildClmmCollectFeesTransaction(params: ClmmCollectFeesParams): EvmTransactionRequest {
    const maxU128 = (1n << 128n) - 1n;
    const data = encodeFunctionData({
      abi: CLMM_POSITION_MANAGER_ABI,
      functionName: 'collect',
      args: [
        {
          tokenId: params.tokenId,
          recipient: params.recipient,
          amount0Max: params.amount0Max ?? maxU128,
          amount1Max: params.amount1Max ?? maxU128,
        },
      ],
    });

    return {
      to: params.positionManagerAddress,
      data,
      value: 0n,
    };
  }

  // -------------------------------------------------------------
  // Simulation
  // -------------------------------------------------------------

  public async simulate(
    from: `0x${string}`,
    tx: EvmTransactionRequest,
  ): Promise<EvmSimulationResult> {
    try {
      const result = await this.publicClient.call({
        account: from,
        to: tx.to,
        data: tx.data,
        value: tx.value ?? 0n,
      });

      return {
        success: true,
        gasUsed: tx.gasLimit ?? 150_000n,
        returnData: result.data,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err.message ?? 'EVM contract call simulation failed',
      };
    }
  }
}

