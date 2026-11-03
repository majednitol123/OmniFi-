/**
 * Stable error codes for OmniFi API and SDK.
 * RFC 7807 Problem Details Taxonomy
 *
 * RULES:
 * 1. Codes are permanently numbered and NEVER reassigned or removed.
 * 2. New codes are appended to their corresponding domain range.
 */
export enum ErrorCode {
  // General (1000-1999)
  INTERNAL_ERROR = 1000,
  INVALID_REQUEST = 1001,
  RATE_LIMITED = 1002,
  NOT_FOUND = 1003,
  UNAUTHORIZED = 1004,

  // Network (2000-2999)
  UNSUPPORTED_NETWORK = 2000,
  NETWORK_CONGESTED = 2001,
  RPC_UNAVAILABLE = 2002,
  INVALID_BLOCK_OR_SLOT = 2003,

  // Token (3000-3999)
  UNKNOWN_TOKEN = 3000,
  BLOCKED_TOKEN = 3001,
  UNSUPPORTED_TOKEN_BEHAVIOR = 3002,
  DECIMAL_OVERFLOW = 3003,

  // Quote & Pricing (4000-4999)
  INSUFFICIENT_LIQUIDITY = 4000,
  PRICE_IMPACT_TOO_HIGH = 4001,
  QUOTE_EXPIRED = 4002,
  ZERO_OUTPUT_AMOUNT = 4003,

  // Swap & Execution (5000-5999)
  SLIPPAGE_EXCEEDED = 5000,
  TRANSACTION_REVERTED = 5001,
  INSUFFICIENT_BALANCE = 5002,
  INSUFFICIENT_ALLOWANCE = 5003,
  DEADLINE_EXCEEDED = 5004,

  // Positions & Liquidity (6000-6999)
  INVALID_TICK_RANGE = 6000,
  POSITION_NOT_FOUND = 6001,
  ZERO_LIQUIDITY = 6002,
  TICK_NOT_INITIALIZED = 6003,
}

export interface ChainErrorContext {
  readonly revertReason?: string | undefined;
  readonly programErrorCode?: number | undefined;
  readonly transactionId?: string | undefined;
  readonly blockOrSlot?: string | undefined;
}

export interface ApiError {
  /** Stable integer error code */
  readonly code: ErrorCode;

  /** Developer technical message */
  readonly message: string;

  /** Actionable, user-friendly UI message */
  readonly userMessage: string;

  /** Underlying chain error details if available */
  readonly chainError?: ChainErrorContext | undefined;
}

export class OmniFiApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown | undefined;
  readonly userMessage?: string | undefined;

  constructor(
    message: string,
    code: ErrorCode,
    status: number,
    details?: unknown | undefined,
    userMessage?: string | undefined,
  ) {
    super(userMessage || message);
    this.name = 'OmniFiApiError';
    this.code = code;
    this.status = status;
    this.details = details;
    this.userMessage = userMessage;
  }
}

