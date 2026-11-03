/**
 * Network configuration types for OmniFi.
 * Network Configuration & Registry Definitions (ADR-001)
 */

export interface NativeCurrency {
  readonly name: string;
  readonly symbol: string;
  readonly decimals: number;
}

export interface FinalityPolicy {
  /** Minimum confirmations required for 'confirmed' status */
  readonly confirmed: number;
  /** Minimum confirmations required for 'finalized' status */
  readonly finalized: number;
  /** Typical block or slot time in milliseconds (for UX duration estimation) */
  readonly avgBlockTimeMs: number;
}

export interface NetworkFeatures {
  /** Constant product V2 AMM supported on this chain */
  readonly v2Amm: boolean;
  /** Concentrated liquidity CLMM supported on this chain */
  readonly clmm: boolean;
  /** Permit2 signature authorization supported (EVM only) */
  readonly permit2: boolean;
}

export interface NetworkConfig {
  /** Unique key identifying the network, e.g. "ethereum-sepolia", "solana-devnet" */
  readonly id: string;

  /** Human-readable display name for UI */
  readonly displayName: string;

  /** CAIP-2 namespace ('eip155' | 'solana') */
  readonly namespace: 'eip155' | 'solana';

  /** Chain reference (EVM chain ID e.g. "11155111" or Solana cluster e.g. "devnet") */
  readonly chainRef: string;

  /** Whether this is a testnet environment */
  readonly isTestnet: boolean;

  /** Active protocol features on this network */
  readonly features: NetworkFeatures;

  /** Finality confirmations policy */
  readonly finality: FinalityPolicy;

  /** Block explorer base URL */
  readonly explorerUrl: string;

  /** Transaction URL pattern with {tx} placeholder */
  readonly explorerTxPattern: string;

  /** Address URL pattern with {address} placeholder */
  readonly explorerAddressPattern: string;

  /** Native gas currency metadata */
  readonly nativeCurrency: NativeCurrency;

  /** UI Icon identifier */
  readonly iconId: string;
}

