import { z } from 'zod';
import { RiskTier, EvmTokenBehavior } from './types';

export const AssetRefSchema = z.object({
  namespace: z.enum(['eip155', 'solana']),
  chainRef: z.string().min(1),
  address: z.string().min(1),
  tokenProgramId: z.string().min(1).optional(),
});

export const SolanaTokenExtensionsSchema = z.object({
  hasTransferFee: z.boolean(),
  hasInterestBearing: z.boolean(),
  hasTransferHook: z.boolean(),
  isNonTransferable: z.boolean(),
  hasConfidentialTransfer: z.boolean(),
  hasPermanentDelegate: z.boolean(),
});

export const TokenEntrySchema = z
  .object({
    assetRef: AssetRefSchema,
    name: z.string().min(1),
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(255),
    riskTier: z.nativeEnum(RiskTier),
    evmBehavior: z.nativeEnum(EvmTokenBehavior).optional(),
    solanaExtensions: SolanaTokenExtensionsSchema.optional(),
    logoUri: z.string().url().optional(),
    isNativeGas: z.boolean(),
    tags: z.array(z.string()),
    blockReason: z.string().optional(),
  })
  .refine(
    data => {
      if (data.riskTier === RiskTier.Blocked && !data.blockReason) {
        return false;
      }
      return true;
    },
    {
      message: 'blockReason must be provided when riskTier is Blocked',
    },
  );
