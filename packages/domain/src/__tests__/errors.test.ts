import { describe, expect, it } from 'vitest';
import { parseEvmRevert, EvmError } from '../errors/evm';
import { parseSolanaProgramError, SolanaProgramErrorCode, SolanaError } from '../errors/solana';
import { toUserMessage } from '../errors/user-facing';

describe('Chain-Specific Error Taxonomy', () => {
  describe('EVM Revert Parsing', () => {
    it('parses slippage breach revert into 5000 with actionable message', () => {
      const err = parseEvmRevert('SlippageExceeded()', '0xabc123', '1000000');
      expect(err).toBeInstanceOf(EvmError);
      expect(err.code).toBe(5000);
      expect(err.userMessage).toContain('price moved outside your slippage');
      expect(err.recoveryAction).toContain('Increase your slippage');
      expect(err.chainDetails?.transactionId).toBe('0xabc123');
    });

    it('parses insufficient liquidity into 4000', () => {
      const err = parseEvmRevert('InsufficientLiquidity()');
      expect(err.code).toBe(4000);
      expect(err.userMessage).toContain('not currently have enough liquidity');
    });

    it('parses token transfer failure into 5002', () => {
      const err = parseEvmRevert('TransferFailed()');
      expect(err.code).toBe(5002);
      expect(err.userMessage).toContain('Check your wallet balance and token allowance');
    });

    it('parses invalid tick into 6000', () => {
      const err = parseEvmRevert('InvalidTickRange()');
      expect(err.code).toBe(6000);
    });
  });

  describe('Solana Program Error Parsing', () => {
    it('parses custom Solana SlippageExceeded (6001) into code 5000', () => {
      const err = parseSolanaProgramError(
        SolanaProgramErrorCode.SlippageExceeded,
        '5abc...',
        '200000',
      );
      expect(err).toBeInstanceOf(SolanaError);
      expect(err.code).toBe(5000);
      expect(err.chainDetails?.programErrorCode).toBe(6001);
      expect(err.chainDetails?.transactionId).toBe('5abc...');
    });

    it('parses custom Solana InsufficientFunds (6000) into code 5002', () => {
      const err = parseSolanaProgramError(SolanaProgramErrorCode.InsufficientFunds);
      expect(err.code).toBe(5002);
      expect(err.userMessage).toContain('Insufficient token or SOL balance');
    });

    it('parses InvalidTickArray (6010) into code 6000', () => {
      const err = parseSolanaProgramError(SolanaProgramErrorCode.InvalidTickArray);
      expect(err.code).toBe(6000);
    });
  });

  describe('User-Facing Notification Formatter', () => {
    it('formats OmniFiError into clean, actionable UI notification without technical jargon', () => {
      const evmErr = parseEvmRevert('SlippageExceeded()');
      const notification = toUserMessage(evmErr);

      expect(notification.title).toBe('Swap Unsuccessful');
      expect(notification.message).toContain('slippage');
      expect(notification.action).toBeDefined();
      expect(notification.type).toBe('info');
    });

    it('handles standard wallet rejection errors gently', () => {
      const rejectedErr = new Error('User rejected the transaction');
      const notification = toUserMessage(rejectedErr);

      expect(notification.title).toBe('Transaction Cancelled');
      expect(notification.type).toBe('info');
    });
  });
});
