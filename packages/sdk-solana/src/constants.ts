import { PublicKey } from '@solana/web3.js';

export const OMNIFI_AMM_PROGRAM_ID = new PublicKey(
  'Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3',
);

export const OMNIFI_CLMM_PROGRAM_ID = new PublicKey(
  'BSn4qU6Reocr7apUznvRkXLQ4psydsrayW9YWyToD6x2',
);

// Constant Product AMM Seeds
export const GLOBAL_CONFIG_SEED = Buffer.from('omnifi-config');
export const POOL_STATE_SEED = Buffer.from('omnifi-pool');
export const POOL_AUTHORITY_SEED = Buffer.from('omnifi-authority');
export const LP_MINT_SEED = Buffer.from('omnifi-lp-mint');

// Concentrated Liquidity (CLMM) Seeds
export const CLMM_GLOBAL_CONFIG_SEED = Buffer.from('clmm_config');
export const CLMM_POOL_STATE_SEED = Buffer.from('clmm_pool');
export const CLMM_POOL_AUTHORITY_SEED = Buffer.from('clmm_authority');
export const CLMM_TICK_ARRAY_SEED = Buffer.from('omnifi-tick-array');
export const CLMM_POSITION_SEED = Buffer.from('omnifi-position');

// Standard aliases
export const TICK_ARRAY_SEED = CLMM_TICK_ARRAY_SEED;
export const POSITION_SEED = CLMM_POSITION_SEED;

export const MINIMUM_LIQUIDITY = 1000n;
export const FEE_DENOMINATOR = 1_000_000n;

// Constant product fee tiers
export const ALLOWED_FEE_TIERS = [100, 500, 3000, 10000] as const;
export type FeeTier = (typeof ALLOWED_FEE_TIERS)[number];

// CLMM Constants
export const TICK_ARRAY_SIZE = 88;
export const MIN_TICK = -443636;
export const MAX_TICK = 443636;

// Sqrt price bounds in Q32.64 format
export const MIN_SQRT_PRICE = 4295048016n;
export const MAX_SQRT_PRICE = 79226673515401279992447579062n;

export interface ClmmFeeTierConfig {
  fee: number;
  tickSpacing: number;
}

export const CLMM_FEE_TIERS: readonly ClmmFeeTierConfig[] = [
  { fee: 100, tickSpacing: 1 },
  { fee: 500, tickSpacing: 10 },
  { fee: 3000, tickSpacing: 60 },
  { fee: 10000, tickSpacing: 200 },
] as const;

export const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL',
);
