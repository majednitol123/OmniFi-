use anchor_lang::prelude::*;

#[error_code]
pub enum ClmmError {
    #[msg("Token mints must be strictly sorted (mint_0 < mint_1)")]
    TokensNotSorted,

    #[msg("Identical token mints are not allowed")]
    IdenticalTokenMints,

    #[msg("Fee tier is not supported")]
    InvalidFeeTier,

    #[msg("Tick spacing is not supported for this fee tier")]
    InvalidTickSpacing,

    #[msg("Protocol fee fraction exceeds maximum allowed (25%)")]
    ProtocolFeeTooHigh,

    #[msg("Emergency pause is active")]
    EmergencyPaused,

    #[msg("Pool is paused")]
    PoolPaused,

    #[msg("Invalid authority or unauthorized caller")]
    Unauthorized,

    #[msg("Arithmetic overflow, underflow, or division by zero")]
    MathOverflow,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Liquidity amount must be greater than zero")]
    ZeroLiquidity,

    #[msg("Tick is out of valid range [-443636, 443636]")]
    TickOutOfBounds,

    #[msg("Tick is not aligned with tick spacing")]
    TickNotAligned,

    #[msg("Lower tick must be strictly less than upper tick")]
    InvalidTickRange,

    #[msg("Start tick index for tick array is not aligned to array size * tick spacing")]
    InvalidStartTickIndex,

    #[msg("Tick index out of tick array bounds")]
    TickOffsetOutOfBounds,

    #[msg("Sqrt price is out of bounds [MIN_SQRT_PRICE, MAX_SQRT_PRICE]")]
    SqrtPriceOutOfBounds,

    #[msg("Slippage tolerance exceeded")]
    SlippageExceeded,

    #[msg("Price limit is invalid for the swap direction")]
    InvalidPriceLimit,

    #[msg("Tick array does not belong to this pool")]
    InvalidTickArrayPool,

    #[msg("Provided tick array does not cover the required tick range")]
    InvalidTickArraySequence,

    #[msg("Missing expected adjacent tick array during crossing")]
    MissingAdjacentTickArray,

    #[msg("Position cannot be closed because it still has active liquidity")]
    PositionNotEmpty,

    #[msg("Position cannot be closed because uncollected fees remain")]
    UncollectedFeesRemain,

    #[msg("Amount exceeds maximum allowed")]
    AmountExceedsMaximum,

    #[msg("Amount received is below minimum required")]
    AmountBelowMinimum,
}

