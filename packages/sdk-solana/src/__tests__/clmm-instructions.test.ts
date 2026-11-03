import { Keypair, PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  buildClosePositionIx,
  buildCollectFeesIx,
  buildDecreaseLiquidityIx,
  buildIncreaseLiquidityIx,
  buildInitializePoolIx,
  buildInitializeTickArrayIx,
  buildOpenPositionIx,
  buildSwapIx,
  getAnchorInstructionDiscriminator,
} from '../clmm';
import {
  OMNIFI_CLMM_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from '../constants';

describe('CLMM Instruction Builders', () => {
  const dummyPk1 = Keypair.generate().publicKey;
  const dummyPk2 = Keypair.generate().publicKey;
  const dummyPk3 = Keypair.generate().publicKey;

  it('computes correct anchor 8-byte instruction discriminators', () => {
    const disc = getAnchorInstructionDiscriminator('initialize_pool');
    expect(disc).toHaveLength(8);
  });

  it('builds initialize_pool instruction correctly', () => {
    const ix = buildInitializePoolIx({
      payer: dummyPk1,
      config: dummyPk2,
      tokenMint0: dummyPk1,
      tokenMint1: dummyPk2,
      tokenVault0: dummyPk1,
      tokenVault1: dummyPk2,
      poolState: dummyPk3,
      poolAuthority: dummyPk2,
      feeTier: 3000,
      tickSpacing: 60,
      initSqrtPriceX64: 1n << 64n,
    });

    expect(ix.programId.toBase58()).toBe(OMNIFI_CLMM_PROGRAM_ID.toBase58());
    expect(ix.keys).toHaveLength(11);
    expect(ix.data.subarray(0, 8)).toEqual(getAnchorInstructionDiscriminator('initialize_pool'));
  });

  it('builds initialize_tick_array instruction correctly', () => {
    const ix = buildInitializeTickArrayIx({
      payer: dummyPk1,
      poolState: dummyPk2,
      tickArray: dummyPk3,
      startTickIndex: -5280,
    });

    expect(ix.programId.toBase58()).toBe(OMNIFI_CLMM_PROGRAM_ID.toBase58());
    expect(ix.keys).toHaveLength(4);
    expect(ix.data.readInt32LE(8)).toBe(-5280);
  });

  it('builds open_position instruction correctly', () => {
    const ix = buildOpenPositionIx({
      payer: dummyPk1,
      owner: dummyPk2,
      poolState: dummyPk3,
      position: dummyPk1,
      tickLowerIndex: -600,
      tickUpperIndex: 600,
    });

    expect(ix.programId.toBase58()).toBe(OMNIFI_CLMM_PROGRAM_ID.toBase58());
    expect(ix.keys).toHaveLength(5);
    expect(ix.data.readInt32LE(8)).toBe(-600);
    expect(ix.data.readInt32LE(12)).toBe(600);
  });

  it('builds increase_liquidity and decrease_liquidity instructions', () => {
    const incIx = buildIncreaseLiquidityIx({
      owner: dummyPk1,
      poolState: dummyPk2,
      position: dummyPk3,
      config: dummyPk1,
      tokenVault0: dummyPk2,
      tokenVault1: dummyPk3,
      userToken0: dummyPk1,
      userToken1: dummyPk2,
      tickArrayLower: dummyPk3,
      tickArrayUpper: dummyPk1,
      liquidityDelta: 100_000n,
      amount0Max: 50_000n,
      amount1Max: 50_000n,
    });

    expect(incIx.keys).toHaveLength(11); // 9 base + 2 distinct tick arrays

    const decIx = buildDecreaseLiquidityIx({
      owner: dummyPk1,
      poolState: dummyPk2,
      position: dummyPk3,
      config: dummyPk1,
      tokenVault0: dummyPk2,
      tokenVault1: dummyPk3,
      userToken0: dummyPk1,
      userToken1: dummyPk2,
      tickArrayLower: dummyPk3,
      liquidityDelta: 50_000n,
      amount0Min: 20_000n,
      amount1Min: 20_000n,
    });

    expect(decIx.keys).toHaveLength(10); // 9 base + 1 tick array (same array)
  });

  it('builds swap instruction with up to 3 tick arrays', () => {
    const swapIx = buildSwapIx({
      user: dummyPk1,
      config: dummyPk2,
      poolState: dummyPk3,
      tokenVault0: dummyPk1,
      tokenVault1: dummyPk2,
      userSource: dummyPk3,
      userDestination: dummyPk1,
      tickArrays: [dummyPk1, dummyPk2, dummyPk3],
      amount: 1_000_000n,
      otherAmountThreshold: 900_000n,
      sqrtPriceLimitX64: 1n << 64n,
      isExactInput: true,
      zeroForOne: true,
    });

    expect(swapIx.keys).toHaveLength(9 + 3); // 9 base + 3 tick arrays
    expect(swapIx.data.subarray(0, 8)).toEqual(getAnchorInstructionDiscriminator('swap'));
  });

  it('builds collect_fees and close_position instructions', () => {
    const collectIx = buildCollectFeesIx({
      owner: dummyPk1,
      poolState: dummyPk2,
      position: dummyPk3,
      tokenVault0: dummyPk1,
      tokenVault1: dummyPk2,
      recipientToken0: dummyPk3,
      recipientToken1: dummyPk1,
    });
    expect(collectIx.keys).toHaveLength(9);

    const closeIx = buildClosePositionIx({
      owner: dummyPk1,
      position: dummyPk2,
    });
    expect(closeIx.keys).toHaveLength(2);
  });
});
