import { z } from 'zod';

export const NativeCurrencySchema = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  decimals: z.number().int().min(0).max(255),
});

export const FinalityPolicySchema = z.object({
  confirmed: z.number().int().min(1),
  finalized: z.number().int().min(1),
  avgBlockTimeMs: z.number().int().positive(),
});

export const NetworkFeaturesSchema = z.object({
  v2Amm: z.boolean(),
  clmm: z.boolean(),
  permit2: z.boolean(),
});

export const NetworkConfigSchema = z.object({
  id: z.string().min(1),
  displayName: z.string().min(1),
  namespace: z.enum(['eip155', 'solana']),
  chainRef: z.string().min(1),
  isTestnet: z.boolean(),
  features: NetworkFeaturesSchema,
  finality: FinalityPolicySchema,
  explorerUrl: z.string().url(),
  explorerTxPattern: z.string().includes('{tx}'),
  explorerAddressPattern: z.string().includes('{address}'),
  nativeCurrency: NativeCurrencySchema,
  iconId: z.string().min(1),
});

