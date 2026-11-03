import { PublicKey } from '@solana/web3.js';
import { describe, expect, it } from 'vitest';
import {
  deriveClmmAuthorityAddress,
  deriveClmmGlobalConfigAddress,
  deriveClmmPoolAddress,
  derivePositionAddress,
  deriveTickArrayAddress,
  getTickArrayStartIndex,
  getTickOffsetInArray,
  sortMints,
} from '../pda';
import {
  OMNIFI_CLMM_PROGRAM_ID,
  TICK_ARRAY_SIZE,
} from '../constants';

describe('CLMM PDA Derivations', () => {
  const mintA = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const mintB = new PublicKey('So11111111111111111111111111111111111111112');
  const owner = new PublicKey('11111111111111111111111111111111');

  it('derives CLMM global config PDA deterministically', () => {
    const [configPda, bump] = deriveClmmGlobalConfigAddress();
    expect(configPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);

    const [configPda2] = deriveClmmGlobalConfigAddress();
    expect(configPda.toBase58()).toEqual(configPda2.toBase58());
  });

  it('derives CLMM pool address deterministically', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda, bump] = deriveClmmPoolAddress(m0, m1, 3000);
    expect(poolPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);

    const [poolPda2] = deriveClmmPoolAddress(m0, m1, 3000);
    expect(poolPda.toBase58()).toEqual(poolPda2.toBase58());
  });

  it('derives CLMM pool authority PDA', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda] = deriveClmmPoolAddress(m0, m1, 3000);
    const [authPda, bump] = deriveClmmAuthorityAddress(poolPda);
    expect(authPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);
  });

  it('derives TickArray PDA deterministically', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda] = deriveClmmPoolAddress(m0, m1, 3000);
    const [tickArrayPda, bump] = deriveTickArrayAddress(poolPda, 0);
    expect(tickArrayPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);

    const [tickArrayPda2] = deriveTickArrayAddress(poolPda, 0);
    expect(tickArrayPda.toBase58()).toEqual(tickArrayPda2.toBase58());

    // Negative tick array start
    const [negTickArrayPda] = deriveTickArrayAddress(poolPda, -5280);
    expect(negTickArrayPda).toBeDefined();
    expect(negTickArrayPda.toBase58()).not.toEqual(tickArrayPda.toBase58());
  });

  it('derives Position PDA deterministically', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda] = deriveClmmPoolAddress(m0, m1, 3000);
    const [posPda, bump] = derivePositionAddress(poolPda, owner, -600, 600);
    expect(posPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);

    const [posPda2] = derivePositionAddress(poolPda, owner, -600, 600);
    expect(posPda.toBase58()).toEqual(posPda2.toBase58());
  });

  it('computes tick array start index using signed floor division', () => {
    const tickSpacing = 60;
    const ticksInArray = TICK_ARRAY_SIZE * tickSpacing; // 88 * 60 = 5280

    expect(getTickArrayStartIndex(0, tickSpacing)).toBe(0);
    expect(getTickArrayStartIndex(60, tickSpacing)).toBe(0);
    expect(getTickArrayStartIndex(5279, tickSpacing)).toBe(0);
    expect(getTickArrayStartIndex(5280, tickSpacing)).toBe(5280);

    // Negative ticks: floor division
    expect(getTickArrayStartIndex(-1, tickSpacing)).toBe(-5280);
    expect(getTickArrayStartIndex(-60, tickSpacing)).toBe(-5280);
    expect(getTickArrayStartIndex(-5280, tickSpacing)).toBe(-5280);
    expect(getTickArrayStartIndex(-5281, tickSpacing)).toBe(-10560);
  });

  it('computes tick offset in array correctly', () => {
    const tickSpacing = 10;
    const startTick = 0;

    expect(getTickOffsetInArray(0, startTick, tickSpacing)).toBe(0);
    expect(getTickOffsetInArray(10, startTick, tickSpacing)).toBe(1);
    expect(getTickOffsetInArray(870, startTick, tickSpacing)).toBe(87);

    // Errors
    expect(() => getTickOffsetInArray(-10, startTick, tickSpacing)).toThrow(
      'Tick out of bounds for tick array',
    );
    expect(() => getTickOffsetInArray(15, startTick, tickSpacing)).toThrow(
      'Tick not aligned to tick spacing',
    );
    expect(() => getTickOffsetInArray(880, startTick, tickSpacing)).toThrow(
      'Tick offset exceeds tick array size',
    );
  });
});

