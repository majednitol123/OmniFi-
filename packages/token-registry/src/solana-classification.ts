import { SolanaTokenExtensions, RiskTier } from './types';

export interface SolanaClassificationResult {
  readonly recommendedTier: RiskTier;
  readonly isAllowedInPool: boolean;
  readonly isAllowedInSwap: boolean;
  readonly reason?: string | undefined;
}

/**
 * Evaluates Solana Token / Token-2022 extensions against Release 1 protocol rules.
 * Source: docs/security/token-compatibility.md
 */
export function classifySolanaToken(
  extensions?: SolanaTokenExtensions,
  isManuallyReviewed = false,
): SolanaClassificationResult {
  if (!extensions) {
    // Standard SPL token
    return {
      recommendedTier: isManuallyReviewed ? RiskTier.Verified : RiskTier.Unverified,
      isAllowedInPool: true,
      isAllowedInSwap: true,
    };
  }

  // Non-transferable tokens can never be traded or pooled
  if (extensions.isNonTransferable) {
    return {
      recommendedTier: RiskTier.Blocked,
      isAllowedInPool: false,
      isAllowedInSwap: false,
      reason: 'Non-transferable (soulbound) tokens cannot be transferred or traded.',
    };
  }

  // Transfer hooks execute arbitrary third-party programs - blocked in R1
  if (extensions.hasTransferHook) {
    return {
      recommendedTier: RiskTier.Blocked,
      isAllowedInPool: false,
      isAllowedInSwap: false,
      reason:
        'Tokens with transfer hook programs are blocked in R1 due to reentrancy and arbitrary execution risks.',
    };
  }

  // Interest-bearing tokens alter balances continuously - blocked in R1
  if (extensions.hasInterestBearing) {
    return {
      recommendedTier: RiskTier.Blocked,
      isAllowedInPool: false,
      isAllowedInSwap: false,
      reason: 'Interest-bearing tokens with variable balances are blocked in R1.',
    };
  }

  // Confidential transfers hide amounts - cannot be verified on-chain in AMM
  if (extensions.hasConfidentialTransfer) {
    return {
      recommendedTier: RiskTier.Blocked,
      isAllowedInPool: false,
      isAllowedInSwap: false,
      reason: 'Confidential transfer tokens are incompatible with transparent AMM pools in R1.',
    };
  }

  // Permanent delegate allows arbitrary token clawback - requires manual review
  if (extensions.hasPermanentDelegate && !isManuallyReviewed) {
    return {
      recommendedTier: RiskTier.Unverified,
      isAllowedInPool: false,
      isAllowedInSwap: false,
      reason:
        'Tokens with permanent delegate authority require manual operational review before enabling.',
    };
  }

  // Transfer fee tokens are supported for swaps with fee deduction math
  if (extensions.hasTransferFee) {
    return {
      recommendedTier: isManuallyReviewed ? RiskTier.Verified : RiskTier.Unverified,
      isAllowedInPool: false, // LP pool vaults don't support dynamic transfer fees in R1
      isAllowedInSwap: true,
      reason:
        'Tokens with transfer fees are supported for swaps with fee adjustment, but liquidity pools are disabled in R1.',
    };
  }

  return {
    recommendedTier: isManuallyReviewed ? RiskTier.Verified : RiskTier.Unverified,
    isAllowedInPool: true,
    isAllowedInSwap: true,
  };
}
