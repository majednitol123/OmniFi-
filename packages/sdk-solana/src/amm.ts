import {
  AccountMeta,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  TransactionInstruction,
} from '@solana/web3.js';
import { getAnchorInstructionDiscriminator } from './clmm';
import {
  OMNIFI_AMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './constants';
import {
  deriveGlobalConfigAddress,
  deriveLpMintAddress,
  derivePoolAddress,
  derivePoolAuthorityAddress,
} from './pda';

export interface BuildAmmSwapParams {
  programId?: PublicKey;
  user: PublicKey;
  poolState: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  userSource: PublicKey;
  userDestination: PublicKey;
  amountIn: bigint;
  minimumAmountOut: bigint;
  zeroForOne: boolean;
}

export function buildAmmSwapIx(params: BuildAmmSwapParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_AMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('swap_exact_input');
  const [config] = deriveGlobalConfigAddress(programId);
  const [poolAuthority] = derivePoolAuthorityAddress(params.poolState, programId);

  // Args: amount_in: u64, minimum_amount_out: u64, zero_for_one: bool
  const data = Buffer.alloc(8 + 8 + 8 + 1);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.amountIn, 8);
  data.writeBigUInt64LE(params.minimumAmountOut, 16);
  data.writeUInt8(params.zeroForOne ? 1 : 0, 24);

  const keys: AccountMeta[] = [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.userSource, isSigner: false, isWritable: true },
    { pubkey: params.userDestination, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildAmmAddLiquidityParams {
  programId?: PublicKey;
  user: PublicKey;
  poolState: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  lpMint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  amount0Desired: bigint;
  amount1Desired: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export function buildAmmAddLiquidityIx(params: BuildAmmAddLiquidityParams): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_AMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('add_liquidity');
  const [config] = deriveGlobalConfigAddress(programId);
  const [poolAuthority] = derivePoolAuthorityAddress(params.poolState, programId);

  // Args: amount_0_desired: u64, amount_1_desired: u64, amount_0_min: u64, amount_1_min: u64
  const data = Buffer.alloc(8 + 8 + 8 + 8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.amount0Desired, 8);
  data.writeBigUInt64LE(params.amount1Desired, 16);
  data.writeBigUInt64LE(params.amount0Min, 24);
  data.writeBigUInt64LE(params.amount1Min, 32);

  const keys: AccountMeta[] = [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

export interface BuildAmmRemoveLiquidityParams {
  programId?: PublicKey;
  user: PublicKey;
  poolState: PublicKey;
  tokenVault0: PublicKey;
  tokenVault1: PublicKey;
  lpMint: PublicKey;
  userToken0: PublicKey;
  userToken1: PublicKey;
  userLp: PublicKey;
  liquidity: bigint;
  amount0Min: bigint;
  amount1Min: bigint;
}

export function buildAmmRemoveLiquidityIx(
  params: BuildAmmRemoveLiquidityParams,
): TransactionInstruction {
  const programId = params.programId ?? OMNIFI_AMM_PROGRAM_ID;
  const discriminator = getAnchorInstructionDiscriminator('remove_liquidity');
  const [config] = deriveGlobalConfigAddress(programId);
  const [poolAuthority] = derivePoolAuthorityAddress(params.poolState, programId);

  // Args: liquidity: u64, amount_0_min: u64, amount_1_min: u64
  const data = Buffer.alloc(8 + 8 + 8 + 8);
  discriminator.copy(data, 0);
  data.writeBigUInt64LE(params.liquidity, 8);
  data.writeBigUInt64LE(params.amount0Min, 16);
  data.writeBigUInt64LE(params.amount1Min, 24);

  const keys: AccountMeta[] = [
    { pubkey: config, isSigner: false, isWritable: false },
    { pubkey: params.poolState, isSigner: false, isWritable: true },
    { pubkey: poolAuthority, isSigner: false, isWritable: false },
    { pubkey: params.tokenVault0, isSigner: false, isWritable: true },
    { pubkey: params.tokenVault1, isSigner: false, isWritable: true },
    { pubkey: params.lpMint, isSigner: false, isWritable: true },
    { pubkey: params.userToken0, isSigner: false, isWritable: true },
    { pubkey: params.userToken1, isSigner: false, isWritable: true },
    { pubkey: params.userLp, isSigner: false, isWritable: true },
    { pubkey: params.user, isSigner: true, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
  ];

  return new TransactionInstruction({ programId, keys, data });
}

