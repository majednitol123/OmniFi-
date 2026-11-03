import { EvmTokenBehavior, RiskTier } from './types';

export interface EvmClassificationResult {
  readonly behavior: EvmTokenBehavior;
  readonly recommendedTier: RiskTier;
  readonly isAllowedInPool: boolean;
  readonly isAllowedInSwap: boolean;
  readonly reason?: string | undefined;
}

/**
 * Evaluates EVM token behavior against Release 1 protocol compatibility rules.
 * Source: docs/security/token-compatibility.md
 */
export function classifyEvmToken(
  behavior: EvmTokenBehavior,
  isManuallyReviewed = false,
): EvmClassificationResult {
  switch (behavior) {
    case EvmTokenBehavior.Standard:
      return {
        behavior,
        recommendedTier: isManuallyReviewed ? RiskTier.Verified : RiskTier.Unverified,
        isAllowedInPool: true,
        isAllowedInSwap: true,
      };

    case EvmTokenBehavior.FeeOnTransfer:
      // In R1: Read-only quotes permitted, LP operations blocked
      return {
        behavior,
        recommendedTier: RiskTier.Unverified,
        isAllowedInPool: false,
        isAllowedInSwap: true,
        reason:
          'Fee-on-transfer tokens are supported for swaps with slippage adjustments, but LP pools are disabled in R1.',
      };

    case EvmTokenBehavior.Rebasing:
      // In R1: Strictly blocked to prevent vault accounting desynchronization
      return {
        behavior,
        recommendedTier: RiskTier.Blocked,
        isAllowedInPool: false,
        isAllowedInSwap: false,
        reason:
          'Rebasing tokens alter balances outside transfer events and are strictly blocked in R1.',
      };

    case EvmTokenBehavior.Pausable:
      if (isManuallyReviewed) {
        return {
          behavior,
          recommendedTier: RiskTier.Verified,
          isAllowedInPool: true,
          isAllowedInSwap: true,
          reason:
            'Token has administrative pause capability, but has been verified for protocol participation.',
        };
      }
      return {
        behavior,
        recommendedTier: RiskTier.Unverified,
        isAllowedInPool: false,
        isAllowedInSwap: false,
        reason: 'Unverified pausable tokens cannot be used until manual audit review is completed.',
      };
  }
}
