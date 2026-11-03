import { AssetRef, serializeAssetRef } from './asset-ref';

/**
 * Shortens a blockchain address for clean display (e.g., 0xA0b8...1234).
 */
export function shortenAddress(address: string, leadingChars = 6, trailingChars = 4): string {
  if (!address) return '';
  if (address.length <= leadingChars + trailingChars) {
    return address;
  }
  return `${address.slice(0, leadingChars)}…${address.slice(-trailingChars)}`;
}

/**
 * Returns a human-readable display string for an AssetRef.
 */
export function formatAssetRef(ref: AssetRef): string {
  const shortAddr = shortenAddress(ref.address);
  if (ref.namespace === 'eip155') {
    return `[EVM ${ref.chainRef}] ${shortAddr}`;
  }
  if (ref.namespace === 'solana') {
    return `[Solana ${ref.chainRef}] ${shortAddr}`;
  }
  return serializeAssetRef(ref);
}

