import { createHash } from 'node:crypto';
import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  OMNIFI_CLMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './constants';
import {
  deriveClmmAuthorityAddress,
  derivePositionAddress,
  deriveTickArrayAddress,
} from './pda';

/**
 * Computes Anchor instruction 8-byte discriminator from instruction name:
 * sha256("global:<name>")[0..8]
 */
export function getAnchorInstructionDiscriminator(name: string): Buffer {
  return createHash('sha256').update(`global:${name}`).digest().subarray(0, 8);
}

export interface BuildInitializePoolParams {
  programId?: PublicKey;
  payer: PublicKey;
  config: PublicKey;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  poolState: PublicKey;
  poolAuthority: PublicKey;
  feeTier: number;
  tickSpacing: number;
  initSqrtPriceX64: bigint;
}

export function buildInitializePoolIx(params: BuildInitializePoolParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('initialize_pool');

  // Args: fee_tier: u32, tick_spacing: u16, init_sqrt_price_x64: u128
  const data = Buffer.alloc(8 + 4 + 2 + 16);
  discriminator.copy(data, 0);
  data.writeUInt32LE(params.feeTier, 8);
  data.writeUInt16LE(params.tickSpacing, 12);
  data.writeBigUInt64LE(params.initSqrtPriceX64 & 0xffffffffffffffffn, 14);
  data.writeBigUInt64LE(params.initSqrtPriceX64 >> 64n, 22);

  const keys: AccountMeta[] = [
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: params.poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenMint0, isSigner: false, isWritable: false },
    { pubkey: params.tokenMint1, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildInitializeTickArrayParams {
  programId?: PublicKey;
  payer: PublicKey;
  poolState: PublicKey;
  tickArray: PublicKey;
  startTickIndex: number;
}

export function buildInitializeTickArrayIx(
  params: BuildInitializeTickArrayParams,
): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('initialize_tick_array');

  // Args: start_tick_index: i32
  const data = Buffer.alloc(8 + 4);
  discriminator.copy(data, 0);
  data.writeInt32LE(params.startTickIndex, 8);

  const keys: AccountMeta[] = [
    { pubkey: params.poolState, isSigner: false, isWritable: false },
    { pubkey: params.tickArray, isSigner: false, isWritable: true },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildOpenPositionParams {
  programId?: PublicKey;
  payer: PublicKey;
  owner: PublicKey;
  poolState: PublicKey;
  position: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
}

export function buildOpenPositionIx(params: BuildOpenPositionParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('open_position');

  // Args: tick_lower_index: i32, tick_upper_index: i32
  const data = Buffer.alloc(8 + 4 + 4);
  discriminator.copy(data, 0);
  data.writeInt32LE(params.tickLowerIndex, 8);
  data.writeInt32LE(params.tickUpperIndex, 12);

  const keys: AccountMeta[] = [
    { pubkey: params.poolState, isSigner: false, isWritable: false },
    { pubkey: params.position, isSigner: false, isWritable: true },
    { pubkey: params.owner, isSigner: false, isWritable: false },
    { pubkey: params.payer, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildIncreaseLiquidityParams {
  programId?: PublicKey;
  owner: PublicKey;
  poolState: PublicKey;
  position: PublicKey;
  config: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper?: PublicKey;
  liquidityDelta: bigint;
  amount0Max: bigint;
  amount1Max: bigint;
}

export function buildIncreaseLiquidityIx(
  params: BuildIncreaseLiquidityParams,
): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('increase_liquidity');

  // Args: liquidity_delta: u128, amount_0_max: u64, amount_1_max: u64
  const data = Buffer.alloc(8 + 16 + 8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.liquidityDelta & 0xffffffffffffffffn, 8);
  data.writeBigUInt64LE(params.liquidityDelta >> 64n, 16);
  data.writeBigUInt64LE(params.amount0Max, 24);
  data.writeBigUInt64LE(params.amount1Max, 32);

  const keys: AccountMeta[] = [
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: params.position, isSigner: false, isWritable: true },
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    // Remaining accounts: tick arrays
    { pubkey: params.tickArrayLower, isSigner: false, isWritable: true },
  ];

  if (params.tickArrayUpper && !params.tickArrayUpper.equals(params.tickArrayLower)) {
    keys.push({ pubkey: params.tickArrayUpper, isSigner: false, isWritable: true });
  }

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildDecreaseLiquidityParams {
  programId?: PublicKey;
  owner: PublicKey;
  poolState: PublicKey;
  position: PublicKey;
  config: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  tickArrayLower: PublicKey;
  tickArrayUpper?: PublicKey;
  liquidityDelta: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export function buildDecreaseLiquidityIx(
  params: BuildDecreaseLiquidityParams,
): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('decrease_liquidity');

  // Args: liquidity_delta: u128, amount_0_min: u64, amount_1_min: u64
  const data = Buffer.alloc(8 + 16 + 8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.liquidityDelta & 0xffffffffffffffffn, 8);
  data.writeBigUInt64LE(params.liquidityDelta >> 64n, 16);
  data.writeBigUInt64LE(params.amount0Min, 24);
  data.writeBigUInt64LE(params.amount1Min, 32);

  const keys: AccountMeta[] = [
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: params.position, isSigner: false, isWritable: true },
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    // Remaining accounts: tick arrays
    { pubkey: params.tickArrayLower, isSigner: false, isWritable: true },
  ];

  if (params.tickArrayUpper && !params.tickArrayUpper.equals(params.tickArrayLower)) {
    keys.push({ pubkey: params.tickArrayUpper, isSigner: false, isWritable: true });
  }

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildCollectFeesParams {
  programId?: PublicKey;
  owner: PublicKey;
  poolState: PublicKey;
  position: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  recipientToken0: PublicKey;
  recipientToken1: PublicKey;
}

export function buildCollectFeesIx(params: BuildCollectFeesParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('collect_fees');
  const [poolAuthority] = deriveClmmAuthorityAddress(params.poolState, programId);

  const keys: AccountMeta[] = [
    { pubkey: params.poolState, isSigner: false, isWritable: false },
    { pubkey: params.position, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.recipientToken0, isSigner: false, isWritable: true },
    { pubkey: params.recipientToken1, isSigner: false, isWritable: true },
    { pubkey: params.owner, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data: discriminator });
}

export interface BuildClosePositionParams {
  programId?: PublicKey;
  owner: PublicKey;
  position: PublicKey;
}

export function buildClosePositionIx(params: BuildClosePositionParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('close_position');

  const keys: AccountMeta[] = [
    { pubkey: params.position, isSigner: false, isWritable: true },
    { pubkey: params.owner, isSigner: true, isWritable: true },
  ];

  return new TransactionInstruction({ programId, keys, data: discriminator });
}

export interface BuildSwapParams {
  programId?: PublicKey;
  user: PublicKey;
  config: PublicKey;
  poolState: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  userSource: PublicKey;
  userDestination: PublicKey;
  tickArrays: PublicKey[]; // Up to 3 tick arrays in traversal order
  amount: bigint;
  otherAmountThreshold: bigint;
  sqrtPriceLimitX64: bigint;
  isExactInput: boolean;
  zeroForOne: boolean;
}

export function buildSwapIx(params: BuildSwapParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_CLMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('swap');
  const [poolAuthority] = deriveClmmAuthorityAddress(params.poolState, programId);

  // Args:
  // amount: u64 (8 bytes)
  // other_amount_threshold: u64 (8 bytes)
  // sqrt_price_limit_x64: u128 (16 bytes)
  // is_exact_input: bool (1 byte)
  // zero_for_one: bool (1 byte)
  const data = Buffer.alloc(8 + 8 + 8 + 16 + 1 + 1);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.amount, 8);
  data.writeBigUInt64LE(params.otherAmountThreshold, 16);
  data.writeBigUInt64LE(params.sqrtPriceLimitX64 & 0xffffffffffffffffn, 24);
  data.writeBigUInt64LE(params.sqrtPriceLimitX64 >> 64n, 32);
  data.writeUInt8(params.isExactInput ? 1 : 0, 40);
  data.writeUInt8(params.zeroForOne ? 1 : 0, 41);

  const keys: AccountMeta[] = [
    { pubkey: params.config, isSigner: false, isWritable: false },
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.userSource, isSigner: false, isWritable: true },
    { pubkey: params.userDestination, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  // Append remaining tick array accounts
  for (const tickArray of params.tickArrays) {
    keys.push({ pubkey: tickArray, isSigner: false, isWritable: true });
  }

  return new TransactionInstruction({ programId, keys, data });
}

