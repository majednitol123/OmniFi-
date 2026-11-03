import { AssetRef } from '@omnifi/domain';

/**
 * Risk classification tiers for tokens.
 * Source: ADR-006, docs/security/token-compatibility.md
 */
export enum RiskTier {
  /** Manually reviewed and verified by protocol operations */
  Verified = 'verified',
  /** Discovered on-chain or community-submitted, but not formally audited */
  Unverified = 'unverified',
  /** Known malicious, incompatible (e.g. rebasing in R1), or administratively blocked */
  Blocked = 'blocked',
}

/**
 * EVM Token Behavior classification.
 */
export enum EvmTokenBehavior {
  /** Standard ERC-20 token conforming to EIP-20 semantics */
  Standard = 'standard',
  /** Fee-on-transfer token (amount received < amount sent) */
  FeeOnTransfer = 'fee-on-transfer',
  /** Rebasing token where balances change outside of transfer events */
  Rebasing = 'rebasing',
  /** Token with administrative pause functionality */
  Pausable = 'pausable',
}

/**
 * Solana Token-2022 extension flags.
 */
export interface SolanaTokenExtensions {
  /** Mint has transfer fee extension */
  readonly hasTransferFee: boolean;
  /** Mint has interest-bearing extension */
  readonly hasInterestBearing: boolean;
  /** Mint has transfer hook program set */
  readonly hasTransferHook: boolean;
  /** Mint is marked non-transferable (soulbound) */
  readonly isNonTransferable: boolean;
  /** Mint has confidential transfer extension */
  readonly hasConfidentialTransfer: boolean;
  /** Mint has permanent delegate set */
  readonly hasPermanentDelegate: boolean;
}

/**
 * Canonical Token entry in the registry.
 */
export interface TokenEntry {
  /** Canonical asset identity */
  readonly assetRef: AssetRef;

  /** Full display name (e.g. "USD Coin") */
  readonly name: string;

  /** Display ticker symbol (e.g. "USDC"). For display only, never identification! */
  readonly symbol: string;

  /** Token decimal places */
  readonly decimals: number;

  /** Risk tier classification */
  readonly riskTier: RiskTier;

  /** EVM behavior class (if EVM token) */
  readonly evmBehavior?: EvmTokenBehavior | undefined;

  /** Solana extension flags (if Solana token) */
  readonly solanaExtensions?: SolanaTokenExtensions | undefined;

  /** Optional icon/logo URI */
  readonly logoUri?: string | undefined;

  /** Whether this represents native gas currency (or wrapped gas currency) */
  readonly isNativeGas: boolean;

  /** Optional descriptive tags (e.g. "stablecoin", "defi") */
  readonly tags: readonly string[];

  /** Reason for blocking (required if riskTier === Blocked) */
  readonly blockReason?: string | undefined;
}

