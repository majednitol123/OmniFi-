/**
 * OmniFi base error classes and error severities.
 */

export enum ErrorSeverity {
  /** Expected operational outcome (e.g. slippage exceeded, user rejected signature) */
  Info = 'info',
  /** Transient operational problem (e.g. network congestion, rate limited, nonce desync) */
  Warning = 'warning',
  /** Severe invariant violation or technical failure */
  Critical = 'critical',
}

export interface ChainErrorDetails {
  readonly revertReason?: string | undefined;
  readonly programErrorCode?: number | undefined;
  readonly transactionId?: string | undefined;
  readonly blockOrSlot?: string | undefined;
}

export abstract class OmniFiError extends Error {
  public abstract readonly code: number;
  public readonly severity: ErrorSeverity;
  public readonly userMessage: string;
  public readonly recoveryAction?: string | undefined;
  public readonly chainDetails?: ChainErrorDetails | undefined;

  constructor(
    message: string,
    userMessage: string,
    severity: ErrorSeverity = ErrorSeverity.Warning,
    recoveryAction?: string,
    chainDetails?: ChainErrorDetails,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.userMessage = userMessage;
    this.severity = severity;
    this.recoveryAction = recoveryAction;
    this.chainDetails = chainDetails;
  }
}

