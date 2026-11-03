import { AssetRef, serializeAssetRef } from './asset-ref';

/**
 * Immutable token amount backed by native BigInt.
 * Enforces integer-only accounting. NEVER floating point.
 */
export interface TokenAmount {
  /** Raw integer value in smallest token unit (e.g., wei, lamports) */
  readonly raw: bigint;

  /** Token decimal places (e.g., 18 for ETH, 6 for USDC, 9 for SOL) */
  readonly decimals: number;

  /** Canonical asset identity */
  readonly asset: AssetRef;
}

/**
 * Creates a validated TokenAmount instance.
 */
export function createTokenAmount(
  raw: bigint | string,
  decimals: number,
  asset: AssetRef,
): TokenAmount {
  if (decimals < 0 || decimals > 255 || !Number.isInteger(decimals)) {
    throw new RangeError(`Invalid decimals: ${decimals}`);
  }

  const rawBigInt = typeof raw === 'string' ? BigInt(raw) : raw;
  if (rawBigInt < 0n) {
    throw new RangeError(`TokenAmount raw value must not be negative: ${rawBigInt}`);
  }

  return {
    raw: rawBigInt,
    decimals,
    asset,
  };
}

/**
 * Adds two TokenAmounts of the same asset.
 */
export function addAmounts(a: TokenAmount, b: TokenAmount): TokenAmount {
  assertSameAsset(a, b);
  return {
    raw: a.raw + b.raw,
    decimals: a.decimals,
    asset: a.asset,
  };
}

/**
 * Subtracts TokenAmount b from a.
 * Throws if b > a (underflow prevention).
 */
export function subAmounts(a: TokenAmount, b: TokenAmount): TokenAmount {
  assertSameAsset(a, b);
  if (b.raw > a.raw) {
    throw new RangeError(`Underflow subtracting token amount: ${a.raw} - ${b.raw}`);
  }
  return {
    raw: a.raw - b.raw,
    decimals: a.decimals,
    asset: a.asset,
  };
}

/**
 * Compares two TokenAmounts.
 * Returns -1 if a < b, 0 if a == b, 1 if a > b.
 */
export function compareAmounts(a: TokenAmount, b: TokenAmount): number {
  assertSameAsset(a, b);
  if (a.raw < b.raw) return -1;
  if (a.raw > b.raw) return 1;
  return 0;
}

function assertSameAsset(a: TokenAmount, b: TokenAmount): void {
  if (
    a.asset.namespace !== b.asset.namespace ||
    a.asset.chainRef !== b.asset.chainRef ||
    a.asset.address.toLowerCase() !== b.asset.address.toLowerCase()
  ) {
    throw new Error(
      `Cannot operate on different assets: ${serializeAssetRef(a.asset)} vs ${serializeAssetRef(b.asset)}`,
    );
  }
}
