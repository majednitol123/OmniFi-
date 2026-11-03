use anchor_lang::prelude::*;

#[error_code]
pub enum ErrorCode {
    #[msg("Token mints must be strictly sorted: mint_0 < mint_1")]
    TokensNotSorted,

    #[msg("Cannot create a pool with identical token mints")]
    IdenticalTokenMints,

    #[msg("The provided fee tier is not supported")]
    InvalidFeeTier,

    #[msg("Protocol fee fraction exceeds maximum allowed")]
    ProtocolFeeTooHigh,

    #[msg("The pool is currently paused")]
    PoolPaused,

    #[msg("The protocol is currently in emergency pause")]
    EmergencyPaused,

    #[msg("Input or output amount must be strictly greater than zero")]
    ZeroAmount,

    #[msg("Liquidity minted is below the minimum required liquidity")]
    InsufficientLiquidityMinted,

    #[msg("Liquidity burned is zero or insufficient")]
    InsufficientLiquidityBurned,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Constant product invariant violated: k_after < k_before")]
    InvariantViolated,

    #[msg("Invalid PDA bump provided")]
    InvalidPdaBump,

    #[msg("Caller is not authorized to perform this operation")]
    Unauthorized,

    #[msg("Arithmetic overflow or underflow occurred")]
    MathOverflow,

    #[msg("Provided vault does not match the canonical pool vault")]
    InvalidVault,

    #[msg("Unsupported token program provided")]
    InvalidTokenProgram,
}

