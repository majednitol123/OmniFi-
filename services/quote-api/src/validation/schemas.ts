import { parseAssetRef } from '@omnifi/domain';
import { z } from 'zod';

export const AssetRefStringSchema = z
  .string()
  .min(1)
  .refine(
    (val) => parseAssetRef(val) !== null,
    (val) => ({ message: `Invalid canonical CAIP asset reference: "${val}"` }),
  );

export const QuoteQuerySchema = z.object({
  tokenIn: AssetRefStringSchema,
  tokenOut: AssetRefStringSchema,
  amountIn: z
    .string()
    .regex(/^\d+$/, 'amountIn must be a positive integer string')
    .refine((val) => BigInt(val) > 0n, 'amountIn must be greater than zero'),
  slippageToleranceBps: z.coerce.number().int().min(0).max(5000).default(50),
  allowSplits: z.coerce.boolean().default(true),
});

export type QuoteQuery = z.infer<typeof QuoteQuerySchema>;

export const RoutesQuerySchema = z.object({
  tokenIn: AssetRefStringSchema,
  tokenOut: AssetRefStringSchema,
  maxHops: z.coerce.number().int().min(1).max(5).default(3),
});

export type RoutesQuery = z.infer<typeof RoutesQuerySchema>;

export const SimulateBodySchema = z.object({
  intent: z.object({
    intentId: z.string(),
    quoteId: z.string(),
    namespace: z.enum(['eip155', 'solana']),
    chainRef: z.string(),
    to: z.string(),
    from: z.string().optional(),
    data: z.string().optional(),
    value: z.string().optional(),
    instructions: z
      .array(
        z.object({
          programId: z.string(),
          keys: z.array(
            z.object({
              pubkey: z.string(),
              isSigner: z.boolean(),
              isWritable: z.boolean(),
            }),
          ),
          data: z.string(),
        }),
      )
      .optional(),
    estimatedGas: z.coerce.string().optional(),
    estimatedComputeUnits: z.number().optional(),
  }),
  rpcUrl: z.string().url().optional(),
});

export type SimulateBody = z.infer<typeof SimulateBodySchema>;

