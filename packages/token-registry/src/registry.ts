import { AssetRef, serializeAssetRef, assetRefEquals } from '@omnifi/domain';
import { TokenEntry, RiskTier, EvmTokenBehavior } from './types';
import { TokenEntrySchema } from './schema';

/**
 * Curated baseline token entries for testnets and local development.
 */
export const DEFAULT_TOKENS: readonly TokenEntry[] = [
  // EVM Sepolia - Sepolia ETH
  {
    assetRef: {
      namespace: 'eip155',
      chainRef: '11155111',
      address: '0x0000000000000000000000000000000000000000',
    },
    name: 'Sepolia Ether',
    symbol: 'ETH',
    decimals: 18,
    riskTier: RiskTier.Verified,
    evmBehavior: EvmTokenBehavior.Standard,
    isNativeGas: true,
    tags: ['native', 'gas'],
  },
  // EVM Sepolia - WETH
  {
    assetRef: {
      namespace: 'eip155',
      chainRef: '11155111',
      address: '0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9',
    },
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    riskTier: RiskTier.Verified,
    evmBehavior: EvmTokenBehavior.Standard,
    isNativeGas: false,
    tags: ['wrapped', 'defi'],
  },
  // EVM Sepolia - Mock USDC
  {
    assetRef: {
      namespace: 'eip155',
      chainRef: '11155111',
      address: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
    },
    name: 'USD Coin (Testnet)',
    symbol: 'USDC',
    decimals: 6,
    riskTier: RiskTier.Verified,
    evmBehavior: EvmTokenBehavior.Standard,
    isNativeGas: false,
    tags: ['stablecoin'],
  },
  // Solana Devnet - Native SOL
  {
    assetRef: {
      namespace: 'solana',
      chainRef: 'devnet',
      address: '11111111111111111111111111111111',
    },
    name: 'Solana',
    symbol: 'SOL',
    decimals: 9,
    riskTier: RiskTier.Verified,
    isNativeGas: true,
    tags: ['native', 'gas'],
  },
  // Solana Devnet - Mock USDC
  {
    assetRef: {
      namespace: 'solana',
      chainRef: 'devnet',
      address: '4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',
      tokenProgramId: 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
    },
    name: 'USD Coin (Devnet)',
    symbol: 'USDC',
    decimals: 6,
    riskTier: RiskTier.Verified,
    isNativeGas: false,
    tags: ['stablecoin'],
  },
];

export class TokenRegistry {
  private readonly tokensByRef = new Map<string, TokenEntry>();

  constructor(initialTokens: readonly TokenEntry[] = DEFAULT_TOKENS) {
    for (const token of initialTokens) {
      this.registerToken(token);
    }
  }

  /**
   * Registers a token in the registry with schema validation.
   */
  public registerToken(token: TokenEntry): void {
    const valid = TokenEntrySchema.parse(token);
    const key = serializeAssetRef(valid.assetRef).toLowerCase();

    if (this.tokensByRef.has(key)) {
      throw new Error(`Token already registered: ${key}`);
    }

    this.tokensByRef.set(key, valid as TokenEntry);
  }

  /**
   * Looks up a token by AssetRef.
   * If not found, generates a fallback entry with RiskTier.Unverified.
   */
  public getOrCreateToken(ref: AssetRef, fallbackDecimals = 18): TokenEntry {
    const key = serializeAssetRef(ref).toLowerCase();
    const existing = this.tokensByRef.get(key);
    if (existing) {
      return existing;
    }

    // Default unverified entry for newly observed tokens (ADR-006)
    return {
      assetRef: ref,
      name: `Unknown Token (${ref.address.slice(0, 6)}…)`,
      symbol: 'UNKNOWN',
      decimals: fallbackDecimals,
      riskTier: RiskTier.Unverified,
      isNativeGas: false,
      tags: ['unverified'],
    };
  }

  /**
   * Retrieves an explicitly registered token by AssetRef.
   */
  public getToken(ref: AssetRef): TokenEntry | undefined {
    const key = serializeAssetRef(ref).toLowerCase();
    return this.tokensByRef.get(key);
  }

  /**
   * Lists all tokens for a given network reference.
   */
  public listTokensForNetwork(
    namespace: 'eip155' | 'solana',
    chainRef: string,
  ): readonly TokenEntry[] {
    return Array.from(this.tokensByRef.values()).filter(
      t => t.assetRef.namespace === namespace && t.assetRef.chainRef === chainRef,
    );
  }

  /**
   * Lists tokens by RiskTier.
   */
  public listTokensByRisk(tier: RiskTier): readonly TokenEntry[] {
    return Array.from(this.tokensByRef.values()).filter(t => t.riskTier === tier);
  }
}
