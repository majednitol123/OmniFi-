import { OmniFiError, ErrorSeverity, ChainErrorDetails } from './base';

export class SolanaError extends OmniFiError {
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
 * Standard Anchor / OmniFi Solana custom program error codes.
 */
export enum SolanaProgramErrorCode {
  InsufficientFunds = 6000,
  SlippageExceeded = 6001,
  ZeroAmount = 6002,
  PoolLocked = 6003,
  InvalidTickArray = 6010,
  TickSpacingMismatch = 6011,
  InvalidPosition = 6020,
}

/**
 * Parses Solana transaction error or program error log.
 */
export function parseSolanaProgramError(
  errorCode: number,
  signature?: string,
  slot?: string,
): SolanaError {
  const details: ChainErrorDetails = {
    programErrorCode: errorCode,
    transactionId: signature,
    blockOrSlot: slot,
  };

  switch (errorCode) {
    case SolanaProgramErrorCode.SlippageExceeded:
      return new SolanaError(
        5000,
        `Solana program error 6001: SlippageExceeded`,
        'The pool price moved outside your slippage tolerance.',
        ErrorSeverity.Info,
        'Increase your slippage tolerance slightly or retry the swap.',
        details,
      );

    case SolanaProgramErrorCode.InsufficientFunds:
      return new SolanaError(
        5002,
        `Solana program error 6000: InsufficientFunds`,
        'Insufficient token or SOL balance in your account.',
        ErrorSeverity.Warning,
        'Ensure your wallet has enough tokens and SOL for transaction rent and gas.',
        details,
      );

    case SolanaProgramErrorCode.InvalidTickArray:
      return new SolanaError(
        6000,
        `Solana program error 6010: InvalidTickArray`,
        'The tick array accounts provided are out of date or misaligned.',
        ErrorSeverity.Warning,
        'Refresh pool data and reconstruct the transaction.',
        details,
      );

    case SolanaProgramErrorCode.PoolLocked:
      return new SolanaError(
        5001,
        `Solana program error 6003: PoolLocked`,
        'The liquidity pool is temporarily locked.',
        ErrorSeverity.Warning,
        'Wait a moment and retry.',
        details,
      );

    default:
      return new SolanaError(
        1000,
        `Unknown Solana program error code: ${errorCode}`,
        'The Solana program instruction failed.',
        ErrorSeverity.Critical,
        'Please report this error with your transaction signature.',
        details,
      );
  }
}

