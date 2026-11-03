import { describe, expect, it } from 'vitest';
import { RiskTier, EvmTokenBehavior } from '../types';
import { classifyEvmToken } from '../evm-classification';
import { classifySolanaToken } from '../solana-classification';
import { TokenRegistry, DEFAULT_TOKENS } from '../registry';
import { parseAssetRef } from '@omnifi/domain';

describe('Token Metadata & Risk Classification (ADR-006, token-compatibility.md)', () => {
  describe('EVM Token Classification', () => {
    it('classifies standard ERC-20 tokens as allowed in pool and swap', () => {
      const standard = classifyEvmToken(EvmTokenBehavior.Standard, true);
      expect(standard.recommendedTier).toBe(RiskTier.Verified);
      expect(standard.isAllowedInPool).toBe(true);
      expect(standard.isAllowedInSwap).toBe(true);
    });

    it('classifies fee-on-transfer tokens as allowed in swap but blocked in LP pools', () => {
      const fot = classifyEvmToken(EvmTokenBehavior.FeeOnTransfer);
      expect(fot.isAllowedInPool).toBe(false);
      expect(fot.isAllowedInSwap).toBe(true);
      expect(fot.reason).toBeDefined();
    });

    it('STRICTLY BLOCKS rebasing tokens in R1 to prevent vault accounting drift', () => {
      const rebasing = classifyEvmToken(EvmTokenBehavior.Rebasing);
      expect(rebasing.recommendedTier).toBe(RiskTier.Blocked);
      expect(rebasing.isAllowedInPool).toBe(false);
      expect(rebasing.isAllowedInSwap).toBe(false);
      expect(rebasing.reason).toContain('alter balances outside transfer');
    });

    it('requires manual review for pausable tokens before pool inclusion', () => {
      const unreviewed = classifyEvmToken(EvmTokenBehavior.Pausable, false);
      expect(unreviewed.recommendedTier).toBe(RiskTier.Unverified);
      expect(unreviewed.isAllowedInPool).toBe(false);

      const reviewed = classifyEvmToken(EvmTokenBehavior.Pausable, true);
      expect(reviewed.recommendedTier).toBe(RiskTier.Verified);
      expect(reviewed.isAllowedInPool).toBe(true);
    });
  });

  describe('Solana Token & Token-2022 Classification', () => {
    it('classifies standard SPL tokens as verified when reviewed', () => {
      const spl = classifySolanaToken(undefined, true);
      expect(spl.recommendedTier).toBe(RiskTier.Verified);
      expect(spl.isAllowedInPool).toBe(true);
      expect(spl.isAllowedInSwap).toBe(true);
    });

    it('blocks non-transferable (soulbound) tokens', () => {
      const res = classifySolanaToken({
        hasTransferFee: false,
        hasInterestBearing: false,
        hasTransferHook: false,
        isNonTransferable: true,
        hasConfidentialTransfer: false,
        hasPermanentDelegate: false,
      });
      expect(res.recommendedTier).toBe(RiskTier.Blocked);
      expect(res.isAllowedInPool).toBe(false);
      expect(res.isAllowedInSwap).toBe(false);
    });

    it('blocks transfer hook tokens in R1 due to reentrancy risks', () => {
      const res = classifySolanaToken({
        hasTransferFee: false,
        hasInterestBearing: false,
        hasTransferHook: true,
        isNonTransferable: false,
        hasConfidentialTransfer: false,
        hasPermanentDelegate: false,
      });
      expect(res.recommendedTier).toBe(RiskTier.Blocked);
      expect(res.reason).toContain('transfer hook programs are blocked');
    });

    it('blocks interest-bearing and confidential transfer tokens in R1', () => {
      const interestBearing = classifySolanaToken({
        hasTransferFee: false,
        hasInterestBearing: true,
        hasTransferHook: false,
        isNonTransferable: false,
        hasConfidentialTransfer: false,
        hasPermanentDelegate: false,
      });
      expect(interestBearing.recommendedTier).toBe(RiskTier.Blocked);

      const confidential = classifySolanaToken({
        hasTransferFee: false,
        hasInterestBearing: false,
        hasTransferHook: false,
        isNonTransferable: false,
        hasConfidentialTransfer: true,
        hasPermanentDelegate: false,
      });
      expect(confidential.recommendedTier).toBe(RiskTier.Blocked);
    });

    it('allows transfer-fee tokens for swaps with fee adjustments but blocks LP', () => {
      const res = classifySolanaToken(
        {
          hasTransferFee: true,
          hasInterestBearing: false,
          hasTransferHook: false,
          isNonTransferable: false,
          hasConfidentialTransfer: false,
          hasPermanentDelegate: false,
        },
        true,
      );
      expect(res.isAllowedInSwap).toBe(true);
      expect(res.isAllowedInPool).toBe(false);
    });
  });

  describe('Token Registry Management', () => {
    it('defaults unobserved tokens to RiskTier.Unverified', () => {
      const registry = new TokenRegistry();
      const unknownRef = parseAssetRef('eip155:1:0x1111111111111111111111111111111111111111')!;

      const token = registry.getOrCreateToken(unknownRef);
      expect(token.riskTier).toBe(RiskTier.Unverified);
      expect(token.symbol).toBe('UNKNOWN');
    });

    it('retrieves verified tokens from default curated list', () => {
      const registry = new TokenRegistry();
      const usdcRef = parseAssetRef('eip155:11155111:0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238')!;

      const token = registry.getToken(usdcRef);
      expect(token).toBeDefined();
      expect(token?.symbol).toBe('USDC');
      expect(token?.decimals).toBe(6);
      expect(token?.riskTier).toBe(RiskTier.Verified);
    });

    it('filters tokens by network', () => {
      const registry = new TokenRegistry();
      const sepoliaTokens = registry.listTokensForNetwork('eip155', '11155111');
      expect(sepoliaTokens.length).toBeGreaterThanOrEqual(3);

      const solanaDevnetTokens = registry.listTokensForNetwork('solana', 'devnet');
      expect(solanaDevnetTokens.length).toBeGreaterThanOrEqual(2);
    });
  });
});
