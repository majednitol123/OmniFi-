import { RoundingDirection } from './rounding';

/**
 * Arbitrary precision integer mathematics using native BigInt.
 * Enforces explicit rounding directions and prevents silent precision loss.
 */

export const MAX_UINT256 = (1n << 256n) - 1n;

/**
 * Computes ceil(a / b) for non-negative integers.
 * Throws on division by zero or negative operands.
 */
export function ceilDiv(a: bigint, b: bigint): bigint {
  if (b === 0n) {
    throw new RangeError('Division by zero in ceilDiv');
  }
  if (a < 0n || b < 0n) {
    throw new RangeError('ceilDiv operands must be non-negative');
  }
  if (a === 0n) {
    return 0n;
  }
  return (a - 1n) / b + 1n;
}

/**
 * Computes floor(a * b / c).
 * Rounds towards zero.
 */
export function mulDivDown(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) {
    throw new RangeError('Division by zero in mulDivDown');
  }
  if (a < 0n || b < 0n || c < 0n) {
    throw new RangeError('mulDivDown operands must be non-negative');
  }
  return (a * b) / c;
}

/**
 * Computes ceil(a * b / c).
 * Rounds away from zero.
 */
export function mulDivUp(a: bigint, b: bigint, c: bigint): bigint {
  if (c === 0n) {
    throw new RangeError('Division by zero in mulDivUp');
  }
  if (a < 0n || b < 0n || c < 0n) {
    throw new RangeError('mulDivUp operands must be non-negative');
  }
  const prod = a * b;
  if (prod === 0n) {
    return 0n;
  }
  return (prod - 1n) / c + 1n;
}

/**
 * Computes (a * b) / c with explicit rounding direction.
 */
export function mulDiv(
  a: bigint,
  b: bigint,
  c: bigint,
  rounding: RoundingDirection = RoundingDirection.Down,
): bigint {
  return rounding === RoundingDirection.Up ? mulDivUp(a, b, c) : mulDivDown(a, b, c);
}

