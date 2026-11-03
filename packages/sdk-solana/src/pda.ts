import { PublicKey } from '@solana/web3.js';
import {
  CLMM_GLOBAL_CONFIG_SEED,
  CLMM_POOL_AUTHORITY_SEED,
  CLMM_POOL_STATE_SEED,
  CLMM_POSITION_SEED,
  CLMM_TICK_ARRAY_SEED,
  GLOBAL_CONFIG_SEED,
  LP_MINT_SEED,
  OMNIFI_AMM_PROGRAM_ID,
  OMNIFI_CLMM_PROGRAM_ID,
  POOL_AUTHORITY_SEED,
  POOL_STATE_SEED,
  TICK_ARRAY_SIZE,
} from './constants';

/**
 * Sorts two mint addresses canonically (lexicographical comparison).
 */
export function sortMints(mintA: PublicKey, mintB: PublicKey): [PublicKey, PublicKey] {
  if (mintA.equals(mintB)) {
    throw new Error('Identical token mints provided');
  }

  const cmp = mintA.toBuffer().compare(mintB.toBuffer());
  if (cmp < 0) return [mintA, mintB];
  if (cmp > 0) return [mintB, mintA];

  throw new Error('Identical token mints provided');
}

/**
 * Derives the GlobalConfig PDA for Constant Product AMM.
 */
export function deriveGlobalConfigAddress(
  programId: PublicKey = OMNIFI_AMM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([GLOBAL_CONFIG_SEED], programId);
}

/**
 * Derives the PoolState PDA for a token pair and fee tier in Constant Product AMM.
 */
export function derivePoolAddress(
  mint0: PublicKey,
  mint1: PublicKey,
  feeTier: number,
  programId: PublicKey = OMNIFI_AMM_PROGRAM_ID,
): [PublicKey, number] {
  const feeTierBuffer = Buffer.alloc(4);
  feeTierBuffer.writeUInt32LE(feeTier, 0);

  return PublicKey.findProgramAddressSync(
    [POOL_STATE_SEED, mint0.toBuffer(), mint1.toBuffer(), feeTierBuffer],
    programId,
  );
}

/**
 * Derives the off-curve Pool Authority PDA used to sign CPIs and own vaults in Constant Product AMM.
 */
export function derivePoolAuthorityAddress(
  poolState: PublicKey,
  programId: PublicKey = OMNIFI_AMM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([POOL_AUTHORITY_SEED, poolState.toBuffer()], programId);
}

/**
 * Derives the LP Token Mint PDA for a given Constant Product AMM pool.
 */
export function deriveLpMintAddress(
  poolState: PublicKey,
  programId: PublicKey = OMNIFI_AMM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([LP_MINT_SEED, poolState.toBuffer()], programId);
}

// ---------------------------------------------------------
// CLMM (Concentrated Liquidity) PDA Derivations
// ---------------------------------------------------------

/**
 * Derives the GlobalConfig PDA for CLMM.
 */
export function deriveClmmGlobalConfigAddress(
  programId: PublicKey = OMNIFI_CLMM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([CLMM_GLOBAL_CONFIG_SEED], programId);
}

/**
 * Derives the PoolState PDA for CLMM.
 */
export function deriveClmmPoolAddress(
  mint0: PublicKey,
  mint1: PublicKey,
  feeTier: number,
  programId: PublicKey = OMNIFI_CLMM_PROGRAM_ID,
): [PublicKey, number] {
  const feeTierBuffer = Buffer.alloc(4);
  feeTierBuffer.writeUInt32LE(feeTier, 0);

  return PublicKey.findProgramAddressSync(
    [CLMM_POOL_STATE_SEED, mint0.toBuffer(), mint1.toBuffer(), feeTierBuffer],
    programId,
  );
}

/**
 * Derives the Pool Authority PDA for CLMM pool CPI signing and vault ownership.
 */
export function deriveClmmAuthorityAddress(
  poolState: PublicKey,
  programId: PublicKey = OMNIFI_CLMM_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CLMM_POOL_AUTHORITY_SEED, poolState.toBuffer()],
    programId,
  );
}

/**
 * Derives the TickArray PDA for a CLMM pool and start tick index.
 */
export function deriveTickArrayAddress(
  poolState: PublicKey,
  startTickIndex: number,
  programId: PublicKey = OMNIFI_CLMM_PROGRAM_ID,
): [PublicKey, number] {
  const startTickBuffer = Buffer.alloc(4);
  startTickBuffer.writeInt32LE(startTickIndex, 0);

  return PublicKey.findProgramAddressSync(
    [CLMM_TICK_ARRAY_SEED, poolState.toBuffer(), startTickBuffer],
    programId,
  );
}

/**
 * Derives the Position PDA for a CLMM pool, owner, and tick range.
 */
export function derivePositionAddress(
  poolState: PublicKey,
  owner: PublicKey,
  tickLowerIndex: number,
  tickUpperIndex: number,
  programId: PublicKey = OMNIFI_CLMM_PROGRAM_ID,
): [PublicKey, number] {
  const tickLowerBuffer = Buffer.alloc(4);
  tickLowerBuffer.writeInt32LE(tickLowerIndex, 0);

  const tickUpperBuffer = Buffer.alloc(4);
  tickUpperBuffer.writeInt32LE(tickUpperIndex, 0);

  return PublicKey.findProgramAddressSync(
    [CLMM_POSITION_SEED, poolState.toBuffer(), owner.toBuffer(), tickLowerBuffer, tickUpperBuffer],
    programId,
  );
}

/**
 * Calculates start tick index for the tick array enclosing `tick` with `tickSpacing`.
 * Follows signed floor division matching on-chain behavior.
 */
export function getTickArrayStartIndex(tick: number, tickSpacing: number): number {
  const ticksInArray = TICK_ARRAY_SIZE * tickSpacing;
  const realIndex = Math.floor(tick / ticksInArray);
  return realIndex * ticksInArray;
}

/**
 * Calculates tick offset (0..87) inside a tick array given start tick index and spacing.
 */
export function getTickOffsetInArray(
  tick: number,
  startTickIndex: number,
  tickSpacing: number,
): number {
  if (tick < startTickIndex) {
    throw new Error('Tick out of bounds for tick array');
  }
  const delta = tick - startTickIndex;
  if (delta % tickSpacing !== 0) {
    throw new Error('Tick not aligned to tick spacing');
  }
  const offset = delta / tickSpacing;
  if (offset >= TICK_ARRAY_SIZE) {
    throw new Error('Tick offset exceeds tick array size');
  }
  return offset;
}
