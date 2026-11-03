import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { encodeFunctionData } from 'viem';
import { PublicKey } from '@solana/web3.js';
import { CLMM_POSITION_MANAGER_ABI } from '@omnifi/sdk-evm';
import {
  OMNIFI_CLMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  deriveClmmAuthorityAddress,
  buildCollectFeesIx,
} from '@omnifi/sdk-solana';
import { PoolGraph } from '@omnifi/quote-engine';
import { OmniFiDatabaseClient } from '@omnifi/database';
import { sendProblemDetails } from '../errors/problem-details';

const CollectFeesPrepareSchema = z.object({
  namespace: z.enum(['eip155', 'solana']),
  networkId: z.string(),
  owner: z.string(),
  poolId: z.string(),
  positionId: z.string(), // tokenId on EVM, position pubkey on Solana
  recipient: z.string().optional(),
  token0: z.string().optional(),
  token1: z.string().optional(),
});

function deriveAta(owner: PublicKey, mint: PublicKey): PublicKey {
  const [ata] = PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  return ata;
}

export function registerPositionsRoutes(
  fastify: FastifyInstance,
  graph?: PoolGraph,
  db?: OmniFiDatabaseClient,
): void {
  // GET /api/v1/positions
  fastify.get(
    '/api/v1/positions',
    async (
      request: FastifyRequest<{
        Querystring: {
          owner: string;
          networkId?: string;
          poolId?: string;
        };
      }>,
      reply: FastifyReply,
    ) => {
      const { owner, networkId, poolId } = request.query;
      if (!owner) {
        return sendProblemDetails(
          reply,
          400,
          'Bad Request',
          'Query parameter "owner" is required.',
          request.url,
        );
      }

      if (db) {
        const dbPositions = await db.listPositionsByOwner(owner, networkId);
        const filtered = poolId ? dbPositions.filter((p) => p.poolId === poolId) : dbPositions;
        const positions = filtered.map((p) => ({
          positionId: p.positionId,
          networkId: p.networkId,
          namespace: p.networkId.startsWith('solana:') ? 'solana' : 'eip155',
          poolId: p.poolId,
          owner: p.owner,
          onchainPositionId: p.onchainPositionId,
          tickLower: p.tickLower,
          tickUpper: p.tickUpper,
          liquidity: p.liquidity.toString(),
          tokensOwed0: p.tokensOwed0.toString(),
          tokensOwed1: p.tokensOwed1.toString(),
          status: p.status,
          updatedAt: p.updatedAt.toISOString(),
        }));

        return {
          positions,
          total: positions.length,
        };
      }

      // Truthful empty positions list when unpopulated
      return {
        positions: [],
        total: 0,
      };
    },
  );

  // POST /api/v1/positions/collect/prepare
  fastify.post('/api/v1/positions/collect/prepare', async (request, reply) => {
    const parseResult = CollectFeesPrepareSchema.safeParse(request.body);
    if (!parseResult.success) {
      return sendProblemDetails(
        reply,
        400,
        'Invalid Request Body',
        parseResult.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`).join(', '),
        request.url,
      );
    }

    const { namespace, networkId, owner, poolId, positionId, recipient } = parseResult.data;

    if (namespace === 'eip155') {
      // Real ABI-encoded calldata for NonfungiblePositionManager.collect((uint256,address,uint128,uint128))
      const targetRecipient = (recipient || owner) as `0x${string}`;
      const calldata = encodeFunctionData({
        abi: CLMM_POSITION_MANAGER_ABI,
        functionName: 'collect',
        args: [
          {
            tokenId: BigInt(positionId),
            recipient: targetRecipient,
            amount0Max: 2n ** 128n - 1n,
            amount1Max: 2n ** 128n - 1n,
          },
        ],
      });

      return {
        namespace: 'eip155',
        networkId,
        preparedTransaction: {
          to: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
          data: calldata,
          value: '0',
          gasLimit: '150000',
        },
        description: `Collect fees for position #${positionId} on ${networkId}`,
      };
    }

    if (namespace === 'solana') {
      try {
        const ownerPubkey = new PublicKey(owner);
        const positionPubkey = new PublicKey(positionId);
        const poolPubkey = new PublicKey(poolId);
        const targetRecipientPubkey = recipient ? new PublicKey(recipient) : ownerPubkey;
        const programId = OMNIFI_CLMM_PROGRAM_ID;

        const [poolAuthority] = deriveClmmAuthorityAddress(poolPubkey, programId);

        let mint0 = new PublicKey('11111111111111111111111111111111');
        let mint1 = new PublicKey('11111111111111111111111111111112');
        if (parseResult.data.token0 && parseResult.data.token1) {
          mint0 = new PublicKey(parseResult.data.token0);
          mint1 = new PublicKey(parseResult.data.token1);
        } else if (graph) {
          const pool = graph.getPool(poolId);
          if (pool) {
            mint0 = new PublicKey(pool.token0.address);
            mint1 = new PublicKey(pool.token1.address);
          }
        }

        const tokenVault0 = deriveAta(poolAuthority, mint0);
        const tokenVault1 = deriveAta(poolAuthority, mint1);
        const recipientToken0 = deriveAta(targetRecipientPubkey, mint0);
        const recipientToken1 = deriveAta(targetRecipientPubkey, mint1);

        const collectIx = buildCollectFeesIx({
          programId,
          owner: ownerPubkey,
          poolState: poolPubkey,
          position: positionPubkey,
          tokenVault0,
          tokenVault1,
          recipientToken0,
          recipientToken1,
        });

        return {
          namespace: 'solana',
          networkId,
          preparedTransaction: {
            instructions: [
              {
                programId: collectIx.programId.toBase58(),
                keys: collectIx.keys.map((k) => ({
                  pubkey: k.pubkey.toBase58(),
                  isSigner: k.isSigner,
                  isWritable: k.isWritable,
                })),
                data: collectIx.data.toString('hex'),
                dataBase64: collectIx.data.toString('base64'),
              },
            ],
          },
          description: `Collect fees for position ${positionId} on Solana`,
        };
      } catch (err: any) {
        return sendProblemDetails(
          reply,
          400,
          'Solana Fee Collection Preparation Error',
          err?.message || 'Failed to derive Solana fee collection accounts',
          request.url,
        );
      }
    }

    return sendProblemDetails(reply, 400, 'Unsupported Namespace', 'Unsupported namespace', request.url);
  });
}
