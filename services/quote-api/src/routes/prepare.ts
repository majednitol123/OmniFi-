import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { encodeFunctionData } from 'viem';
import { PublicKey } from '@solana/web3.js';
import {
  V2_ROUTER_ABI,
  CLMM_SWAP_ROUTER_ABI,
  CLMM_POSITION_MANAGER_ABI,
} from '@omnifi/sdk-evm';
import {
  OMNIFI_AMM_PROGRAM_ID,
  OMNIFI_CLMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  derivePoolAddress,
  derivePoolAuthorityAddress,
  deriveLpMintAddress,
  deriveClmmPoolAddress,
  deriveClmmAuthorityAddress,
  deriveClmmGlobalConfigAddress,
  deriveTickArrayAddress,
  buildAmmSwapIx,
  buildAmmAddLiquidityIx,
  buildAmmRemoveLiquidityIx,
  buildSwapIx as buildClmmSwapIx,
} from '@omnifi/sdk-solana';
import { sendProblemDetails } from '../errors/problem-details';

const SwapPrepareSchema = z.object({
  namespace: z.enum(['eip155', 'solana']),
  networkId: z.string(),
  userAddress: z.string(),
  protocol: z.enum(['v2', 'clmm', 'v4', 'amm']),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string(),
  minAmountOut: z.string(),
  recipient: z.string().optional(),
  deadline: z.string().optional(),
  routerAddress: z.string().optional(),
  poolAddress: z.string().optional(),
  feeTier: z.number().optional(),
});

const LiquidityAddPrepareSchema = z.object({
  namespace: z.enum(['eip155', 'solana']),
  networkId: z.string(),
  userAddress: z.string(),
  protocol: z.enum(['v2', 'clmm', 'v4', 'amm']),
  token0: z.string(),
  token1: z.string(),
  amount0Desired: z.string(),
  amount1Desired: z.string(),
  amount0Min: z.string(),
  amount1Min: z.string(),
  tickLower: z.number().optional(),
  tickUpper: z.number().optional(),
  feeTier: z.number().optional(),
  recipient: z.string().optional(),
  deadline: z.string().optional(),
  routerAddress: z.string().optional(),
  poolAddress: z.string().optional(),
});

const LiquidityRemovePrepareSchema = z.object({
  namespace: z.enum(['eip155', 'solana']),
  networkId: z.string(),
  userAddress: z.string(),
  protocol: z.enum(['v2', 'clmm', 'v4', 'amm']),
  poolId: z.string(),
  token0: z.string().optional(),
  token1: z.string().optional(),
  positionId: z.string().optional(), // For CLMM NFTs
  liquidity: z.string(),
  amount0Min: z.string(),
  amount1Min: z.string(),
  recipient: z.string().optional(),
  deadline: z.string().optional(),
  routerAddress: z.string().optional(),
});

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

export function registerPrepareRoutes(fastify: FastifyInstance): void {
  // POST /api/v1/swap/prepare
  fastify.post('/api/v1/swap/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = SwapPrepareSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Body',
        parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        request.url,
      );
    }

    const {
      namespace,
      networkId,
      userAddress,
      protocol,
      tokenIn,
      tokenOut,
      amountIn,
      minAmountOut,
      recipient,
      routerAddress,
      poolAddress,
      feeTier,
      deadline,
    } = parseResult.data;

    const targetRecipient = (recipient || userAddress) as `0x${string}`;
    const deadlineBn = deadline
      ? BigInt(deadline)
      : BigInt(Math.floor(Date.now() / 1000) + 1200);

    if (protocol === 'v4') {
      return sendProblemDetails(
        reply,
        400,
        'Protocol Deferred in R1',
        'EVM v4 Singleton Engine public trade preparation is deferred to Release 2 per ADR-004. Use V2 or CLMM.',
        request.url,
      );
    }

    if (namespace === 'eip155') {
      const to = (routerAddress ||
        (protocol === 'clmm'
          ? '0xE592427A0AEce92De3Edee1F18E0157C05861564'
          : '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')) as `0x${string}`;

      let calldata: `0x${string}`;
      if (protocol === 'clmm') {
        calldata = encodeFunctionData({
          abi: CLMM_SWAP_ROUTER_ABI,
          functionName: 'exactInputSingle',
          args: [
            {
              tokenIn: tokenIn as `0x${string}`,
              tokenOut: tokenOut as `0x${string}`,
              fee: feeTier ?? 3000,
              recipient: targetRecipient,
              deadline: deadlineBn,
              amountIn: BigInt(amountIn),
              amountOutMinimum: BigInt(minAmountOut),
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
      } else {
        calldata = encodeFunctionData({
          abi: V2_ROUTER_ABI,
          functionName: 'swapExactTokensForTokens',
          args: [
            BigInt(amountIn),
            BigInt(minAmountOut),
            [tokenIn as `0x${string}`, tokenOut as `0x${string}`],
            targetRecipient,
            deadlineBn,
          ],
        });
      }

      return {
        namespace: 'eip155',
        networkId,
        userAddress,
        preparedTransaction: {
          to,
          data: calldata,
          value: '0',
          gasLimit: protocol === 'clmm' ? '300000' : '250000',
        },
        metadata: {
          tokenIn,
          tokenOut,
          amountIn,
          minAmountOut,
          protocol,
        },
      };
    }

    // Solana Swap Preparation
    try {
      const userKey = new PublicKey(userAddress);
      const mintIn = new PublicKey(tokenIn);
      const mintOut = new PublicKey(tokenOut);

      const zeroForOne = mintIn.toBuffer().compare(mintOut.toBuffer()) < 0;
      const [mint0, mint1] = zeroForOne ? [mintIn, mintOut] : [mintOut, mintIn];

      let swapIx;
      if (protocol === 'clmm') {
        const programId = OMNIFI_CLMM_PROGRAM_ID;
        const poolState = poolAddress
          ? new PublicKey(poolAddress)
          : deriveClmmPoolAddress(mint0, mint1, feeTier ?? 500, programId)[0];
        const [poolAuthority] = deriveClmmAuthorityAddress(poolState, programId);
        const [config] = deriveClmmGlobalConfigAddress(programId);
        const tokenVault0 = deriveAta(poolAuthority, mint0);
        const tokenVault1 = deriveAta(poolAuthority, mint1);
        const userSource = deriveAta(userKey, mintIn);
        const userDestination = deriveAta(userKey, mintOut);
        const [tickArray0] = deriveTickArrayAddress(poolState, 0, programId);

        swapIx = buildClmmSwapIx({
          programId,
          user: userKey,
          config,
          poolState,
          tokenVault0,
          tokenVault1,
          userSource,
          userDestination,
          tickArrays: [tickArray0],
          amount: BigInt(amountIn),
          otherAmountThreshold: BigInt(minAmountOut),
          sqrtPriceLimitX64: zeroForOne ? 4295048016n + 1n : 79226673515401279992447579062n - 1n,
          isExactInput: true,
          zeroForOne,
        });
      } else {
        const programId = OMNIFI_AMM_PROGRAM_ID;
        const poolState = poolAddress
          ? new PublicKey(poolAddress)
          : derivePoolAddress(mint0, mint1, feeTier ?? 3000, programId)[0];

        const [poolAuthority] = derivePoolAuthorityAddress(poolState, programId);
        const tokenVault0 = deriveAta(poolAuthority, mint0);
        const tokenVault1 = deriveAta(poolAuthority, mint1);
        const userSource = deriveAta(userKey, mintIn);
        const userDestination = deriveAta(userKey, mintOut);

        swapIx = buildAmmSwapIx({
          programId,
          user: userKey,
          poolState,
          tokenVault0,
          tokenVault1,
          userSource,
          userDestination,
          amountIn: BigInt(amountIn),
          minimumAmountOut: BigInt(minAmountOut),
          zeroForOne,
        });
      }

      return {
        namespace: 'solana',
        networkId,
        userAddress,
        preparedTransaction: {
          instructions: [
            {
              programId: swapIx.programId.toBase58(),
              keys: swapIx.keys.map((k) => ({
                pubkey: k.pubkey.toBase58(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: swapIx.data.toString('hex'),
              dataBase64: swapIx.data.toString('base64'),
            },
          ],
        },
        metadata: {
          tokenIn,
          tokenOut,
          amountIn,
          minAmountOut,
          protocol,
        },
      };
    } catch (err: any) {
      return sendProblemDetails(
        reply,
        400,
        'Solana Transaction Preparation Error',
        err?.message || 'Failed to derive Solana accounts or instructions',
        request.url,
      );
    }
  });

  // POST /api/v1/liquidity/add/prepare
  fastify.post('/api/v1/liquidity/add/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LiquidityAddPrepareSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Body',
        parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        request.url,
      );
    }

    const {
      namespace,
      networkId,
      userAddress,
      protocol,
      token0,
      token1,
      amount0Desired,
      amount1Desired,
      amount0Min,
      amount1Min,
      tickLower,
      tickUpper,
      feeTier,
      recipient,
      routerAddress,
      poolAddress,
      deadline,
    } = parseResult.data;

    const targetRecipient = (recipient || userAddress) as `0x${string}`;
    const deadlineBn = deadline
      ? BigInt(deadline)
      : BigInt(Math.floor(Date.now() / 1000) + 1200);

    if (protocol === 'v4') {
      return sendProblemDetails(
        reply,
        400,
        'Protocol Deferred in R1',
        'EVM v4 Singleton Engine public trade preparation is deferred to Release 2 per ADR-004. Use V2 or CLMM.',
        request.url,
      );
    }

    if (namespace === 'eip155') {
      const to = (routerAddress ||
        (protocol === 'clmm'
          ? '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
          : '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')) as `0x${string}`;

      let calldata: `0x${string}`;
      if (protocol === 'clmm') {
        calldata = encodeFunctionData({
          abi: CLMM_POSITION_MANAGER_ABI,
          functionName: 'mint',
          args: [
            {
              token0: token0 as `0x${string}`,
              token1: token1 as `0x${string}`,
              fee: feeTier ?? 3000,
              tickLower: tickLower ?? -887220,
              tickUpper: tickUpper ?? 887220,
              amount0Desired: BigInt(amount0Desired),
              amount1Desired: BigInt(amount1Desired),
              amount0Min: BigInt(amount0Min),
              amount1Min: BigInt(amount1Min),
              recipient: targetRecipient,
              deadline: deadlineBn,
            },
          ],
        });
      } else {
        calldata = encodeFunctionData({
          abi: V2_ROUTER_ABI,
          functionName: 'addLiquidity',
          args: [
            token0 as `0x${string}`,
            token1 as `0x${string}`,
            BigInt(amount0Desired),
            BigInt(amount1Desired),
            BigInt(amount0Min),
            BigInt(amount1Min),
            targetRecipient,
            deadlineBn,
          ],
        });
      }

      return {
        namespace: 'eip155',
        networkId,
        userAddress,
        preparedTransaction: {
          to,
          data: calldata,
          value: '0',
          gasLimit: protocol === 'clmm' ? '400000' : '300000',
        },
        metadata: {
          token0,
          token1,
          amount0Desired,
          amount1Desired,
          protocol,
        },
      };
    }

    // Solana Add Liquidity Preparation
    try {
      const userKey = new PublicKey(userAddress);
      const mint0 = new PublicKey(token0);
      const mint1 = new PublicKey(token1);
      const programId = OMNIFI_AMM_PROGRAM_ID;

      const poolState = poolAddress
        ? new PublicKey(poolAddress)
        : derivePoolAddress(mint0, mint1, feeTier ?? 3000, programId)[0];

      const [poolAuthority] = derivePoolAuthorityAddress(poolState, programId);
      const [lpMint] = deriveLpMintAddress(poolState, programId);
      const tokenVault0 = deriveAta(poolAuthority, mint0);
      const tokenVault1 = deriveAta(poolAuthority, mint1);
      const userToken0 = deriveAta(userKey, mint0);
      const userToken1 = deriveAta(userKey, mint1);
      const userLp = deriveAta(userKey, lpMint);

      const addIx = buildAmmAddLiquidityIx({
        programId,
        user: userKey,
        poolState,
        tokenVault0,
        tokenVault1,
        lpMint,
        userToken0,
        userToken1,
        userLp,
        amount0Desired: BigInt(amount0Desired),
        amount1Desired: BigInt(amount1Desired),
        amount0Min: BigInt(amount0Min),
        amount1Min: BigInt(amount1Min),
      });

      return {
        namespace: 'solana',
        networkId,
        userAddress,
        preparedTransaction: {
          instructions: [
            {
              programId: addIx.programId.toBase58(),
              keys: addIx.keys.map((k) => ({
                pubkey: k.pubkey.toBase58(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: addIx.data.toString('hex'),
              dataBase64: addIx.data.toString('base64'),
            },
          ],
        },
        metadata: {
          token0,
          token1,
          amount0Desired,
          amount1Desired,
          protocol,
        },
      };
    } catch (err: any) {
      return sendProblemDetails(
        reply,
        400,
        'Solana Transaction Preparation Error',
        err?.message || 'Failed to derive Solana accounts or instructions',
        request.url,
      );
    }
  });

  // POST /api/v1/liquidity/remove/prepare
  fastify.post('/api/v1/liquidity/remove/prepare', async (request: FastifyRequest, reply: FastifyReply) => {
    const parseResult = LiquidityRemovePrepareSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Body',
        parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        request.url,
      );
    }

    const {
      namespace,
      networkId,
      userAddress,
      protocol,
      poolId,
      token0,
      token1,
      positionId,
      liquidity,
      amount0Min,
      amount1Min,
      recipient,
      routerAddress,
      deadline,
    } = parseResult.data;

    const targetRecipient = (recipient || userAddress) as `0x${string}`;
    const deadlineBn = deadline
      ? BigInt(deadline)
      : BigInt(Math.floor(Date.now() / 1000) + 1200);

    if (protocol === 'v4') {
      return sendProblemDetails(
        reply,
        400,
        'Protocol Deferred in R1',
        'EVM v4 Singleton Engine public trade preparation is deferred to Release 2 per ADR-004. Use V2 or CLMM.',
        request.url,
      );
    }

    if (namespace === 'eip155') {
      const to = (routerAddress ||
        (protocol === 'clmm'
          ? '0xC36442b4a4522E871399CD717aBDD847Ab11FE88'
          : '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D')) as `0x${string}`;

      let calldata: `0x${string}`;
      if (protocol === 'clmm') {
        calldata = encodeFunctionData({
          abi: CLMM_POSITION_MANAGER_ABI,
          functionName: 'decreaseLiquidity',
          args: [
            {
              tokenId: BigInt(positionId || 1),
              liquidity: BigInt(liquidity),
              amount0Min: BigInt(amount0Min),
              amount1Min: BigInt(amount1Min),
              deadline: deadlineBn,
            },
          ],
        });
      } else {
        const t0 = (token0 || '0x0000000000000000000000000000000000000001') as `0x${string}`;
        const t1 = (token1 || '0x0000000000000000000000000000000000000002') as `0x${string}`;
        calldata = encodeFunctionData({
          abi: V2_ROUTER_ABI,
          functionName: 'removeLiquidity',
          args: [
            t0,
            t1,
            BigInt(liquidity),
            BigInt(amount0Min),
            BigInt(amount1Min),
            targetRecipient,
            deadlineBn,
          ],
        });
      }

      return {
        namespace: 'eip155',
        networkId,
        userAddress,
        preparedTransaction: {
          to,
          data: calldata,
          value: '0',
          gasLimit: '250000',
        },
        metadata: {
          poolId,
          liquidity,
          amount0Min,
          amount1Min,
        },
      };
    }

    // Solana Remove Liquidity Preparation
    try {
      const userKey = new PublicKey(userAddress);
      const poolState = new PublicKey(poolId);
      const programId = OMNIFI_AMM_PROGRAM_ID;

      const [poolAuthority] = derivePoolAuthorityAddress(poolState, programId);
      const [lpMint] = deriveLpMintAddress(poolState, programId);

      // Default or passed mints
      const mint0 = token0 ? new PublicKey(token0) : new PublicKey('11111111111111111111111111111111');
      const mint1 = token1 ? new PublicKey(token1) : new PublicKey('11111111111111111111111111111112');

      const tokenVault0 = deriveAta(poolAuthority, mint0);
      const tokenVault1 = deriveAta(poolAuthority, mint1);
      const userToken0 = deriveAta(userKey, mint0);
      const userToken1 = deriveAta(userKey, mint1);
      const userLp = deriveAta(userKey, lpMint);

      const removeIx = buildAmmRemoveLiquidityIx({
        programId,
        user: userKey,
        poolState,
        tokenVault0,
        tokenVault1,
        lpMint,
        userToken0,
        userToken1,
        userLp,
        liquidity: BigInt(liquidity),
        amount0Min: BigInt(amount0Min),
        amount1Min: BigInt(amount1Min),
      });

      return {
        namespace: 'solana',
        networkId,
        userAddress,
        preparedTransaction: {
          instructions: [
            {
              programId: removeIx.programId.toBase58(),
              keys: removeIx.keys.map((k) => ({
                pubkey: k.pubkey.toBase58(),
                isSigner: k.isSigner,
                isWritable: k.isWritable,
              })),
              data: removeIx.data.toString('hex'),
              dataBase64: removeIx.data.toString('base64'),
            },
          ],
        },
        metadata: {
          poolId,
          liquidity,
          amount0Min,
          amount1Min,
        },
      };
    } catch (err: any) {
      return sendProblemDetails(
        reply,
        400,
        'Solana Transaction Preparation Error',
        err?.message || 'Failed to derive Solana accounts or instructions',
        request.url,
      );
    }
  });
}
