/// Global seeds for Program Derived Addresses (PDAs)
pub const GLOBAL_CONFIG_SEED: &[u8] = b"clmm_config";
pub const POOL_STATE_SEED: &[u8] = b"clmm_pool";
pub const POOL_AUTHORITY_SEED: &[u8] = b"clmm_authority";
pub const TICK_ARRAY_SEED: &[u8] = b"omnifi-tick-array";
pub const POSITION_SEED: &[u8] = b"omnifi-position";

/// Number of ticks per tick array account
pub const TICK_ARRAY_SIZE: usize = 88;

/// Fee denominator: 1e6 (1,000,000) = 100%
pub const FEE_DENOMINATOR: u32 = 1_000_000;

/// Max protocol fee fraction: 250,000 / 1,000,000 = 25% of LP fee
pub const MAX_PROTOCOL_FEE_FRACTION: u32 = 250_000;

/// Tick boundaries
pub const MIN_TICK: i32 = -443636;
pub const MAX_TICK: i32 = 443636;

/// Sqrt price bounds in Q32.64 format
/// MIN_SQRT_PRICE corresponds to tick -443636
pub const MIN_SQRT_PRICE: u128 = 4295048016;
/// MAX_SQRT_PRICE corresponds to tick 443636
pub const MAX_SQRT_PRICE: u128 = 79226673515401279992447579062;

/// Standard fee tiers (fee in ppm, tick spacing)
pub const FEE_TIERS: [(u32, u16); 4] = [
    (100, 1),     // 0.01% -> tick spacing 1
    (500, 10),    // 0.05% -> tick spacing 10
    (3000, 60),   // 0.30% -> tick spacing 60
    (10000, 200), // 1.00% -> tick spacing 200
];
