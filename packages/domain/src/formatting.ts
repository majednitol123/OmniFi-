import { AssetRef } from './asset-ref';
import { TokenAmount, createTokenAmount } from './amount';

/**
 * Formats a TokenAmount into a human-readable decimal string.
 * Strictly avoids floating point math. Uses integer string splitting.
 *
 * Example:
 * raw = 1500000n, decimals = 6 => "1.5"
 * raw = 1000000000000000000n, decimals = 18 => "1"
 */
export function formatAmount(
  amount: TokenAmount,
  maxDecimals?: number,
  trimTrailingZeros = true,
): string {
  const { raw, decimals } = amount;
  const rawStr = raw.toString();

  if (decimals === 0) {
    return rawStr;
  }

  let whole: string;
  let frac: string;

  if (rawStr.length <= decimals) {
    whole = '0';
    frac = '0'.repeat(decimals - rawStr.length) + rawStr;
  } else {
    whole = rawStr.slice(0, rawStr.length - decimals);
    frac = rawStr.slice(rawStr.length - decimals);
  }

  if (maxDecimals !== undefined && maxDecimals < decimals) {
    frac = frac.slice(0, maxDecimals);
  }

  if (trimTrailingZeros) {
    frac = frac.replace(/0+$/, '');
  }

  if (frac.length === 0) {
    return whole;
  }

  return `${whole}.${frac}`;
}

/**
 * Parses a user input decimal string into a TokenAmount.
 * Strictly avoids floating point parsing (never uses parseFloat or Number).
 *
 * Example:
 * input = "1.5", decimals = 6 => raw = 1500000n
 */
export function parseAmount(input: string, decimals: number, asset: AssetRef): TokenAmount {
  if (!input || typeof input !== 'string') {
    throw new Error('Input must be a non-empty string');
  }

  const clean = input.trim();
  if (!/^\d+(\.\d+)?$/.test(clean)) {
    throw new Error(`Invalid decimal amount format: ${input}`);
  }

  const parts = clean.split('.');
  const wholePart = parts[0]!;
  let fracPart = parts[1] || '';

  if (fracPart.length > decimals) {
    throw new Error(`Exceeds maximum token decimals of ${decimals}: ${input}`);
  }

  // Pad fraction with zeros to reach full decimal precision
  fracPart = fracPart.padEnd(decimals, '0');

  const combinedStr = `${wholePart}${fracPart}`.replace(/^0+/, '') || '0';
  const raw = BigInt(combinedStr);

  return createTokenAmount(raw, decimals, asset);
}
