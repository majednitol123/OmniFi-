import { describe, expect, it } from 'vitest';
import { AssetRef } from '../asset-ref';
import { createTokenAmount, addAmounts, subAmounts, compareAmounts } from '../amount';
import { ceilDiv, mulDivDown, mulDivUp, mulDiv, MAX_UINT256 } from '../math';
import { RoundingDirection, OPERATION_ROUNDING_POLICY } from '../rounding';
import { formatAmount, parseAmount } from '../formatting';

describe('Amount & Integer Arithmetic Utilities', () => {
  const dummyAsset: AssetRef = {
    namespace: 'eip155',
    chainRef: '1',
    address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  };

  const otherAsset: AssetRef = {
    namespace: 'eip155',
    chainRef: '1',
    address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
  };

  describe('math functions (ceilDiv, mulDivDown, mulDivUp)', () => {
    it('performs exact ceiling division', () => {
      expect(ceilDiv(10n, 3n)).toBe(4n);
      expect(ceilDiv(9n, 3n)).toBe(3n);
      expect(ceilDiv(0n, 5n)).toBe(0n);
      expect(ceilDiv(1n, 1000n)).toBe(1n);
    });

    it('throws on division by zero', () => {
      expect(() => ceilDiv(10n, 0n)).toThrow(RangeError);
      expect(() => mulDivDown(10n, 5n, 0n)).toThrow(RangeError);
      expect(() => mulDivUp(10n, 5n, 0n)).toThrow(RangeError);
    });

    it('computes mulDiv with truncation (Down) and ceiling (Up)', () => {
      // 3 * 5 / 2 = 7.5 => Down: 7, Up: 8
      expect(mulDivDown(3n, 5n, 2n)).toBe(7n);
      expect(mulDivUp(3n, 5n, 2n)).toBe(8n);
      expect(mulDiv(3n, 5n, 2n, RoundingDirection.Down)).toBe(7n);
      expect(mulDiv(3n, 5n, 2n, RoundingDirection.Up)).toBe(8n);

      // Exact division without remainder
      expect(mulDivDown(4n, 5n, 2n)).toBe(10n);
      expect(mulDivUp(4n, 5n, 2n)).toBe(10n);
    });

    it('handles large uint256 boundary values without overflow', () => {
      const halfMax = MAX_UINT256 / 2n;
      const res = mulDivDown(halfMax, 2n, halfMax);
      expect(res).toBe(2n);
    });
  });

  describe('TokenAmount operations', () => {
    it('constructs TokenAmount with string or BigInt', () => {
      const amt1 = createTokenAmount(1000000n, 6, dummyAsset);
      const amt2 = createTokenAmount('1000000', 6, dummyAsset);
      expect(amt1.raw).toBe(1000000n);
      expect(amt2.raw).toBe(1000000n);
      expect(amt1.decimals).toBe(6);
    });

    it('rejects negative amounts', () => {
      expect(() => createTokenAmount(-10n, 6, dummyAsset)).toThrow(RangeError);
      expect(() => createTokenAmount('-100', 6, dummyAsset)).toThrow();
    });

    it('adds and subtracts amounts safely', () => {
      const a = createTokenAmount(500n, 6, dummyAsset);
      const b = createTokenAmount(300n, 6, dummyAsset);

      const sum = addAmounts(a, b);
      expect(sum.raw).toBe(800n);

      const diff = subAmounts(a, b);
      expect(diff.raw).toBe(200n);
    });

    it('throws on subtraction underflow', () => {
      const a = createTokenAmount(300n, 6, dummyAsset);
      const b = createTokenAmount(500n, 6, dummyAsset);
      expect(() => subAmounts(a, b)).toThrow(RangeError);
    });

    it('throws when operating across different assets', () => {
      const a = createTokenAmount(100n, 6, dummyAsset);
      const b = createTokenAmount(100n, 6, otherAsset);
      expect(() => addAmounts(a, b)).toThrow();
      expect(() => subAmounts(a, b)).toThrow();
    });

    it('compares amounts correctly', () => {
      const a = createTokenAmount(100n, 6, dummyAsset);
      const b = createTokenAmount(200n, 6, dummyAsset);
      const c = createTokenAmount(100n, 6, dummyAsset);

      expect(compareAmounts(a, b)).toBe(-1);
      expect(compareAmounts(b, a)).toBe(1);
      expect(compareAmounts(a, c)).toBe(0);
    });
  });

  describe('Decimal string formatting and parsing (no floats)', () => {
    it('formats amounts with correct decimal positioning', () => {
      // 1.5 USDC (6 decimals)
      expect(formatAmount(createTokenAmount(1500000n, 6, dummyAsset))).toBe('1.5');
      // 1 ETH (18 decimals)
      expect(formatAmount(createTokenAmount(1000000000000000000n, 18, dummyAsset))).toBe('1');
      // Sub-unit fractional only: 0.000005
      expect(formatAmount(createTokenAmount(5n, 6, dummyAsset))).toBe('0.000005');
      // 0 amount
      expect(formatAmount(createTokenAmount(0n, 18, dummyAsset))).toBe('0');
    });

    it('parses user decimal strings into exact BigInts', () => {
      expect(parseAmount('1.5', 6, dummyAsset).raw).toBe(1500000n);
      expect(parseAmount('1', 18, dummyAsset).raw).toBe(1000000000000000000n);
      expect(parseAmount('0.000005', 6, dummyAsset).raw).toBe(5n);
      expect(parseAmount('0', 6, dummyAsset).raw).toBe(0n);
      expect(parseAmount('100.25', 2, dummyAsset).raw).toBe(10025n);
    });

    it('rejects parsing with excess decimals or invalid characters', () => {
      // 3 decimal places given, but token only supports 2
      expect(() => parseAmount('1.123', 2, dummyAsset)).toThrow();
      expect(() => parseAmount('abc', 6, dummyAsset)).toThrow();
      expect(() => parseAmount('-1.5', 6, dummyAsset)).toThrow();
    });

    it('enforces protocol master rounding directions', () => {
      expect(OPERATION_ROUNDING_POLICY.fee_deduction).toBe(RoundingDirection.Up);
      expect(OPERATION_ROUNDING_POLICY.swap_exact_in_amount_out).toBe(RoundingDirection.Down);
      expect(OPERATION_ROUNDING_POLICY.swap_exact_out_amount_in).toBe(RoundingDirection.Up);
      expect(OPERATION_ROUNDING_POLICY.liquidity_mint).toBe(RoundingDirection.Down);
    });
  });
});
