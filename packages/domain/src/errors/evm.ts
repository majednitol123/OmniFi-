import { OmniFiError, ErrorSeverity, ChainErrorDetails } from './base';

export class EvmError extends OmniFiError {
  public override readonly code: number;

  constructor(
    code: number,
    message: string,
    userMessage: string,
    severity: ErrorSeverity = ErrorSeverity.Warning,
    recoveryAction?: string,
    details?: ChainErrorDetails,
  ) {
    super(message, userMessage, severity, recoveryAction, details);
    this.code = code;
  }
}

/**
 * Standard EVM revert signatures and reasons mapping.
 */
export function parseEvmRevert(
  revertData: string,
  txHash?: string,
  blockNumber?: string,
): EvmError {
  const details: ChainErrorDetails = {
    revertReason: revertData,
    transactionId: txHash,
    blockOrSlot: blockNumber,
  };

  const lower = revertData.toLowerCase();

  // Slippage exceeded
  if (lower.includes('slippage') || lower.includes('toolittleout') || lower.includes('toomuchin')) {
    return new EvmError(
      5000,
      `EVM swap reverted due to slippage tolerance breach: ${revertData}`,
      'The pool price moved outside your slippage tolerance.',
      ErrorSeverity.Info,
      'Increase your slippage tolerance slightly or retry the swap.',
      details,
    );
  }

  // Insufficient liquidity
  if (lower.includes('insufficientliquidity') || lower.includes('zeroliquidity')) {
    return new EvmError(
      4000,
      `EVM pool has insufficient liquidity for trade size: ${revertData}`,
      'This pool does not currently have enough liquidity for this trade.',
      ErrorSeverity.Warning,
      'Try swapping a smaller amount or choosing a different token pair.',
      details,
    );
  }

  // Insufficient balance / allowance
  if (
    lower.includes('transferfailed') ||
    lower.includes('insufficientbalance') ||
    lower.includes('stf')
  ) {
    return new EvmError(
      5002,
      `Token transfer failed on EVM: ${revertData}`,
      'Token transfer failed. Check your wallet balance and token allowance.',
      ErrorSeverity.Warning,
      'Approve the token contract or ensure your wallet has sufficient balance.',
      details,
    );
  }

  // Invalid tick range
  if (lower.includes('invalidtick') || lower.includes('tickoutofrange')) {
    return new EvmError(
      6000,
      `Invalid tick range specified in EVM CLMM: ${revertData}`,
      'The specified price range boundaries are invalid for this pool.',
      ErrorSeverity.Warning,
      'Adjust your lower and upper price bounds to align with pool tick spacing.',
      details,
    );
  }

  // Default generic revert
  return new EvmError(
    5001,
    `EVM transaction reverted: ${revertData}`,
    'The transaction was reverted by the EVM smart contract.',
    ErrorSeverity.Warning,
    'Review transaction parameters and try again.',
    details,
  );
}
