pub const GLOBAL_CONFIG_SEED: &[u8] = b"omnifi-config";
pub const POOL_STATE_SEED: &[u8] = b"omnifi-pool";
pub const POOL_AUTHORITY_SEED: &[u8] = b"omnifi-authority";
pub const LP_MINT_SEED: &[u8] = b"omnifi-lp-mint";

pub const MINIMUM_LIQUIDITY: u64 = 1000;
pub const FEE_DENOMINATOR: u64 = 1_000_000; // 1e6 hundredths of a bip

// Allowed fee tiers: 0.01% (100), 0.05% (500), 0.30% (3000), 1.00% (10000)
pub const ALLOWED_FEE_TIERS: [u32; 4] = [100, 500, 3000, 10000];

pub const MAX_PROTOCOL_FEE_RATE: u32 = 250_000; // Max 25% of swap fee (250,000 / 1,000,000)

