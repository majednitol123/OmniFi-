import { describe, expect, it } from 'vitest';
import { PublicKey } from '@solana/web3.js';
import {
  deriveGlobalConfigAddress,
  deriveLpMintAddress,
  derivePoolAddress,
  derivePoolAuthorityAddress,
  sortMints,
} from '../pda';
import { OMNIFI_AMM_PROGRAM_ID } from '../constants';

describe('PDA Derivation', () => {
  const mintA = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // USDC
  const mintB = new PublicKey('So11111111111111111111111111111111111111112'); // WSOL

  it('sorts mints canonically', () => {
    const [sorted0, sorted1] = sortMints(mintA, mintB);
    expect(sorted0.toBuffer().compare(sorted1.toBuffer())).toBeLessThan(0);
  });

  it('rejects identical mints', () => {
    expect(() => sortMints(mintA, mintA)).toThrow('Identical token mints provided');
  });

  it('derives global config PDA deterministically', () => {
    const [configPda, bump] = deriveGlobalConfigAddress(OMNIFI_AMM_PROGRAM_ID);
    expect(configPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);
    expect(bump).toBeLessThanOrEqual(255);

    // Verify same address on repeated derivation
    const [configPda2] = deriveGlobalConfigAddress(OMNIFI_AMM_PROGRAM_ID);
    expect(configPda.toBase58()).toEqual(configPda2.toBase58());
  });

  it('derives pool address deterministically', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda, bump] = derivePoolAddress(m0, m1, 3000, OMNIFI_AMM_PROGRAM_ID);
    expect(poolPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);

    const [poolPda2] = derivePoolAddress(m0, m1, 3000, OMNIFI_AMM_PROGRAM_ID);
    expect(poolPda.toBase58()).toEqual(poolPda2.toBase58());
  });

  it('derives pool authority PDA', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda] = derivePoolAddress(m0, m1, 3000, OMNIFI_AMM_PROGRAM_ID);
    const [authPda, bump] = derivePoolAuthorityAddress(poolPda, OMNIFI_AMM_PROGRAM_ID);
    expect(authPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);
  });

  it('derives LP mint PDA', () => {
    const [m0, m1] = sortMints(mintA, mintB);
    const [poolPda] = derivePoolAddress(m0, m1, 3000, OMNIFI_AMM_PROGRAM_ID);
    const [lpMintPda, bump] = deriveLpMintAddress(poolPda, OMNIFI_AMM_PROGRAM_ID);
    expect(lpMintPda).toBeDefined();
    expect(bump).toBeGreaterThanOrEqual(0);
  });
});

