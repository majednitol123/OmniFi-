import { AssetRef, RouteHop, SwapQuote, TransactionIntent } from '@omnifi/domain';
import {
  createPublicClient,
  encodeFunctionData,
  encodePacked,
  Hex,
  http,
  parseAbi,
} from 'viem';

export const V2_ROUTER_ABI = parseAbi([
  'function swapExactTokensForTokens(uint256 amountIn, uint256 amountOutMin, address[] calldata path, address to, uint256 deadline) external returns (uint256[] memory amounts)',
]);

export const CLMM_SWAP_ROUTER_ABI = parseAbi([
  'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
  'function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut)',
  'struct ExactInputParams { bytes path; address recipient; uint256 deadline; uint256 amountIn; uint256 amountOutMinimum; }',
  'function exactInput(ExactInputParams calldata params) external payable returns (uint256 amountOut)',
]);

export interface BuildEvmV2SwapParams {
  routerAddress: `0x${string}`;
  amountIn: bigint;
  amountOutMin: bigint;
  path: `0x${string}`[];
  recipient: `0x${string}`;
  deadline: bigint;
}

export function encodeEvmV2Swap(params: BuildEvmV2SwapParams): Hex {
  return encodeFunctionData({
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
}

export interface BuildEvmClmmSingleSwapParams {
  routerAddress: `0x${string}`;
  tokenIn: `0x${string}`;
  tokenOut: `0x${string}`;
  fee: number;
  recipient: `0x${string}`;
  deadline: bigint;
  amountIn: bigint;
  amountOutMinimum: bigint;
  sqrtPriceLimitX96?: bigint;
}

export function encodeEvmClmmSingleSwap(params: BuildEvmClmmSingleSwapParams): Hex {
  return encodeFunctionData({
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
}

export interface BuildEvmIntentParams {
  quote: SwapQuote;
  routerAddress: `0x${string}`;
  recipient: `0x${string}`;
  slippageToleranceBps?: number; // e.g. 50 = 0.5%
  deadlineSeconds?: bigint;
}

export function buildEvmTransactionIntent(params: BuildEvmIntentParams): TransactionIntent {
  const { quote, routerAddress, recipient, slippageToleranceBps = 50 } = params;
  const deadline =
    BigInt(Math.floor(Date.now() / 1000)) + (params.deadlineSeconds ?? 1200n);

  const amountOutMin =
    (quote.amountOut * (10000n - BigInt(slippageToleranceBps))) / 10000n;

  const firstRoute = quote.routes[0];
  if (!firstRoute || firstRoute.hops.length === 0) {
    throw new Error('No valid route in quote to build EVM intent');
  }

  let callData: Hex;

  if (firstRoute.hops[0]!.pool.poolType === 'v2') {
    const path: `0x${string}`[] = [
      firstRoute.hops[0]!.tokenIn.address as `0x${string}`,
    ];
    for (const hop of firstRoute.hops) {
      path.push(hop.tokenOut.address as `0x${string}`);
    }

    callData = encodeEvmV2Swap({
      routerAddress,
      amountIn: quote.amountIn,
      amountOutMin,
      path,
      recipient,
      deadline,
    });
  } else {
    // CLMM single swap or multi-hop path encoding
    if (firstRoute.hops.length === 1) {
      callData = encodeEvmClmmSingleSwap({
        routerAddress,
        tokenIn: firstRoute.hops[0]!.tokenIn.address as `0x${string}`,
        tokenOut: firstRoute.hops[0]!.tokenOut.address as `0x${string}`,
        fee: firstRoute.hops[0]!.feeTier,
        recipient,
        deadline,
        amountIn: quote.amountIn,
        amountOutMinimum: amountOutMin,
      });
    } else {
      // Pack multi-hop CLMM path: tokenIn (address) + fee (uint24) + tokenOut (address) ...
      const types: string[] = ['address'];
      const values: any[] = [firstRoute.hops[0]!.tokenIn.address as `0x${string}`];

      for (const hop of firstRoute.hops) {
        types.push('uint24');
        types.push('address');
        values.push(hop.feeTier);
        values.push(hop.tokenOut.address as `0x${string}`);
      }

      const path = encodePacked(types as any, values);
      callData = encodeFunctionData({
        abi: CLMM_SWAP_ROUTER_ABI,
        functionName: 'exactInput',
        args: [
          {
            path,
            recipient,
            deadline,
            amountIn: quote.amountIn,
            amountOutMinimum: amountOutMin,
          },
        ],
      });
    }
  }

  return {
    intentId: `evm-intent-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    quoteId: quote.quoteId,
    namespace: 'eip155',
    chainRef: quote.chainRef,
    to: routerAddress,
    data: callData,
    value: '0',
    estimatedGas: 150_000n,
    simulationSuccess: true,
  };
}

export interface SimulationResult {
  success: boolean;
  gasUsed?: bigint | undefined;
  error?: string | undefined;
  returnedData?: Hex | undefined;
}

/**
 * Simulates EVM call against RPC using eth_call.
 */
export async function simulateEvmCall(
  rpcUrl: string,
  from: `0x${string}`,
  intent: TransactionIntent,
): Promise<SimulationResult> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl),
    });

    const [callResult, gasEstimate] = await Promise.all([
      client.call({
        account: from,
        to: intent.to as `0x${string}`,
        data: intent.data as Hex,
        value: intent.value ? BigInt(intent.value) : 0n,
      }),
      client
        .estimateGas({
          account: from,
          to: intent.to as `0x${string}`,
          data: intent.data as Hex,
          value: intent.value ? BigInt(intent.value) : 0n,
        })
        .catch(() => intent.estimatedGas ?? 150_000n),
    ]);

    return {
      success: true,
      gasUsed: gasEstimate,
      returnedData: callResult.data,
    };
  } catch (err: any) {
    const reason =
      err?.shortMessage ||
      err?.reason ||
      err?.details ||
      err?.message ||
      'EVM call simulation reverted';
    return {
      success: false,
      error: reason,
      returnedData: err?.data,
    };
  }
}
