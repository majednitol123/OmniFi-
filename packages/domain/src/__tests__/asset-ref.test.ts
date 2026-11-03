import { describe, expect, it } from 'vitest';
import {
  AssetRef,
  parseAssetRef,
  serializeAssetRef,
  assetRefEquals,
  isNativeCurrency,
  NATIVE_ASSET_ADDRESS,
  SOLANA_NATIVE_MINT,
} from '../asset-ref';
import { createEvmAssetRef, toChecksumAddress, isValidChecksumAddress } from '../asset-evm';
import {
  createSolanaAssetRef,
  SPL_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  isToken2022,
} from '../asset-solana';
import { formatAssetRef, shortenAddress } from '../asset-display';

describe('Asset Identity Model', () => {
  const validEvmAddress = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'; // USDC on Ethereum
  const lowercaseEvmAddress = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48';
  const validSolanaMint = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'; // USDC on Solana

  it('serializes and parses EVM asset references', () => {
    const ref: AssetRef = {
      namespace: 'eip155',
      chainRef: '1',
      address: validEvmAddress,
    };

    const serialized = serializeAssetRef(ref);
    expect(serialized).toBe(`eip155:1:${validEvmAddress}`);

    const parsed = parseAssetRef(serialized);
    expect(parsed).toEqual(ref);
  });

  it('serializes and parses Solana asset references with token program ID', () => {
    const ref: AssetRef = {
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      address: validSolanaMint,
      tokenProgramId: SPL_TOKEN_PROGRAM_ID,
    };

    const serialized = serializeAssetRef(ref);
    expect(serialized).toBe(`solana:mainnet-beta:${validSolanaMint}:${SPL_TOKEN_PROGRAM_ID}`);

    const parsed = parseAssetRef(serialized);
    expect(parsed).toEqual(ref);
  });

  it('NEVER identifies a token by symbol alone', () => {
    expect(parseAssetRef('USDC')).toBeNull();
    expect(parseAssetRef('ETH')).toBeNull();
    expect(parseAssetRef('SOL')).toBeNull();
    expect(parseAssetRef('')).toBeNull();
    expect(parseAssetRef('eip155:1')).toBeNull();
    expect(parseAssetRef('solana:mainnet')).toBeNull();
  });

  it('rejects invalid addresses', () => {
    expect(parseAssetRef('eip155:1:0xinvalid')).toBeNull();
    expect(
      parseAssetRef('eip155:invalid_chain:0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    ).toBeNull();
    expect(parseAssetRef('solana:devnet:invalid_base58_!@#')).toBeNull();
  });

  it('performs case-insensitive comparison for EVM addresses', () => {
    const ref1: AssetRef = { namespace: 'eip155', chainRef: '1', address: validEvmAddress };
    const ref2: AssetRef = { namespace: 'eip155', chainRef: '1', address: lowercaseEvmAddress };
    const refOtherChain: AssetRef = {
      namespace: 'eip155',
      chainRef: '11155111',
      address: validEvmAddress,
    };

    expect(assetRefEquals(ref1, ref2)).toBe(true);
    expect(assetRefEquals(ref1, refOtherChain)).toBe(false);
  });

  it('validates EIP-55 checksumming', () => {
    const checksummed = toChecksumAddress(lowercaseEvmAddress);
    expect(checksummed).toBe(validEvmAddress);
    expect(isValidChecksumAddress(validEvmAddress)).toBe(true);
  });

  it('identifies native currencies correctly', () => {
    const nativeEth: AssetRef = {
      namespace: 'eip155',
      chainRef: '1',
      address: NATIVE_ASSET_ADDRESS,
    };
    const nativeSol: AssetRef = {
      namespace: 'solana',
      chainRef: 'mainnet-beta',
      address: SOLANA_NATIVE_MINT,
    };
    const usdc: AssetRef = {
      namespace: 'eip155',
      chainRef: '1',
      address: validEvmAddress,
    };

    expect(isNativeCurrency(nativeEth)).toBe(true);
    expect(isNativeCurrency(nativeSol)).toBe(true);
    expect(isNativeCurrency(usdc)).toBe(false);
  });

  it('correctly tags Token-2022 programs', () => {
    const standardSpl = createSolanaAssetRef('devnet', validSolanaMint, SPL_TOKEN_PROGRAM_ID);
    const token2022 = createSolanaAssetRef('devnet', validSolanaMint, TOKEN_2022_PROGRAM_ID);

    expect(isToken2022(standardSpl)).toBe(false);
    expect(isToken2022(token2022)).toBe(true);
  });

  it('shortens and formats addresses cleanly for display', () => {
    expect(shortenAddress(validEvmAddress)).toBe('0xA0b8…eB48');
    const ref = createEvmAssetRef('1', validEvmAddress);
    expect(formatAssetRef(ref)).toBe('[EVM 1] 0xA0b8…eB48');
  });
});
