/**
 * Canonical asset identity model for OmniFi.
 *
 * MANDATE:
 * NEVER identify a token by symbol alone. Symbols are mutable, unverified, and non-unique.
 * Tokens must always be identified by their full canonical CAIP-style reference.
 *
 * Formats:
 * - EVM:    eip155:<chainId>:<checksummedAddress>
 * - Solana: solana:<cluster>:<mintAddress>:<tokenProgramId>
 */

export type ChainNamespace = 'eip155' | 'solana';

export interface AssetRef {
  /** CAIP-2 namespace ('eip155' for EVM, 'solana' for Solana) */
  readonly namespace: ChainNamespace;

  /** Chain reference (EVM chain ID e.g. "1", "11155111" or Solana cluster e.g. "mainnet-beta", "devnet", "localnet") */
  readonly chainRef: string;

  /** On-chain address (EIP-55 checksummed for EVM, Base58 mint for Solana) */
  readonly address: string;

  /** Solana only: token program ID (e.g. Tokenkeg... or TokenzQ...) */
  readonly tokenProgramId?: string | undefined;
}

/** Special sentinel address for native gas currencies (ETH, SOL) */
export const NATIVE_ASSET_ADDRESS = '0x0000000000000000000000000000000000000000';
export const SOLANA_NATIVE_MINT = '11111111111111111111111111111111';

/**
 * Serializes an AssetRef into its canonical string representation.
 */
export function serializeAssetRef(ref: AssetRef): string {
  if (ref.namespace === 'solana') {
    if (ref.tokenProgramId) {
      return `solana:${ref.chainRef}:${ref.address}:${ref.tokenProgramId}`;
    }
    return `solana:${ref.chainRef}:${ref.address}`;
  }
  return `eip155:${ref.chainRef}:${ref.address}`;
}

/**
 * Parses a canonical asset string into an AssetRef.
 * Returns null if the format is invalid or symbol-only.
 */
export function parseAssetRef(raw: string): AssetRef | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const parts = raw.trim().split(':');

  // Must have at least namespace, chainRef, and address
  if (parts.length < 3) {
    return null;
  }

  const [namespace, chainRef, address, tokenProgramId] = parts;

  if (!namespace || !chainRef || !address) {
    return null;
  }

  if (namespace === 'eip155') {
    // EVM chainRef must be a positive integer string
    if (!/^\d+$/.test(chainRef)) {
      return null;
    }
    // EVM address must be 42 characters (0x + 40 hex chars)
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return null;
    }
    return {
      namespace: 'eip155',
      chainRef,
      address,
    };
  }

  if (namespace === 'solana') {
    // Solana cluster must be non-empty string
    if (chainRef.length === 0) {
      return null;
    }
    // Base58 regex check (32-44 characters)
    if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address)) {
      return null;
    }
    if (tokenProgramId && !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(tokenProgramId)) {
      return null;
    }
    return {
      namespace: 'solana',
      chainRef,
      address,
      tokenProgramId,
    };
  }

  return null;
}

/**
 * Compares two AssetRefs for equality.
 * For EVM assets, addresses are compared case-insensitively.
 */
export function assetRefEquals(a: AssetRef, b: AssetRef): boolean {
  if (a.namespace !== b.namespace) return false;
  if (a.chainRef !== b.chainRef) return false;

  if (a.namespace === 'eip155') {
    return a.address.toLowerCase() === b.address.toLowerCase();
  }

  if (a.namespace === 'solana') {
    if (a.address !== b.address) return false;
    return a.tokenProgramId === b.tokenProgramId;
  }

  return false;
}

/**
 * Checks whether an asset is the native network currency.
 */
export function isNativeCurrency(ref: AssetRef): boolean {
  if (ref.namespace === 'eip155') {
    return (
      ref.address.toLowerCase() === NATIVE_ASSET_ADDRESS.toLowerCase() ||
      ref.address.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
    );
  }
  if (ref.namespace === 'solana') {
    return ref.address === SOLANA_NATIVE_MINT;
  }
  return false;
}
