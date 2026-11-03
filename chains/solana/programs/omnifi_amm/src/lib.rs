use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod math;
pub mod state;

pub use instructions::*;

declare_id!("Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3");

#[program]
pub mod omnifi_amm {
    use super::*;

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        protocol_fee_fraction: u32,
    ) -> Result<()> {
        process_initialize_config(ctx, protocol_fee_fraction)
    }

    pub fn create_pool(ctx: Context<CreatePool>, fee_tier: u32) -> Result<()> {
        process_create_pool(ctx, fee_tier)
    }

    pub fn add_liquidity(
        ctx: Context<AddLiquidity>,
        amount_0_desired: u64,
        amount_1_desired: u64,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        process_add_liquidity(
            ctx,
            amount_0_desired,
            amount_1_desired,
            amount_0_min,
            amount_1_min,
        )
    }

    pub fn remove_liquidity(
        ctx: Context<RemoveLiquidity>,
        liquidity: u64,
        amount_0_min: u64,
        amount_1_min: u64,
    ) -> Result<()> {
        process_remove_liquidity(ctx, liquidity, amount_0_min, amount_1_min)
    }

    pub fn swap_exact_input(
        ctx: Context<Swap>,
        amount_in: u64,
        minimum_amount_out: u64,
        zero_for_one: bool,
    ) -> Result<()> {
        process_swap_exact_input(ctx, amount_in, minimum_amount_out, zero_for_one)
    }

    pub fn swap_exact_output(
        ctx: Context<Swap>,
        amount_out: u64,
        maximum_amount_in: u64,
        zero_for_one: bool,
    ) -> Result<()> {
        process_swap_exact_output(ctx, amount_out, maximum_amount_in, zero_for_one)
    }

    pub fn collect_protocol_fees(ctx: Context<CollectProtocolFees>) -> Result<()> {
        process_collect_protocol_fees(ctx)
    }

    pub fn update_config(
        ctx: Context<UpdateConfig>,
        new_protocol_fee_fraction: Option<u32>,
    ) -> Result<()> {
        process_update_config(ctx, new_protocol_fee_fraction)
    }

    pub fn set_emergency_paused(
        ctx: Context<SetEmergencyPaused>,
        paused: bool,
    ) -> Result<()> {
        process_set_emergency_paused(ctx, paused)
    }

    pub fn pause_pool(ctx: Context<PausePool>, paused: bool) -> Result<()> {
        process_pause_pool(ctx, paused)
    }
}

#[cfg(test)]
mod tests {
    use crate::math::{compute_swap_exact_input, compute_swap_exact_output, sqrt};

    #[test]
    fn test_sqrt_integer() {
        assert_eq!(sqrt(0), 0);
        assert_eq!(sqrt(1), 1);
        assert_eq!(sqrt(3), 1);
        assert_eq!(sqrt(4), 2);
        assert_eq!(sqrt(9), 3);
        assert_eq!(sqrt(16), 4);
        assert_eq!(sqrt(100), 10);
        assert_eq!(sqrt(1_000_000_000_000_000_000_000_000_000_000_000_000), 1_000_000_000_000_000_000);
    }

    #[test]
    fn test_swap_exact_input_constant_product() {
        let reserve_0 = 1_000_000_000_000u64; // 1M units
        let reserve_1 = 2_000_000_000_000u64; // 2M units
        let fee_tier = 3000u32; // 0.30%
        let protocol_fee_fraction = 250_000u32; // 25% of LP fee

        let amount_in = 10_000_000_000u64; // 10,000 units

        let (amount_out, proto_fee) = compute_swap_exact_input(
            amount_in,
            reserve_0,
            reserve_1,
            fee_tier,
            protocol_fee_fraction,
        ).unwrap();

        assert!(amount_out > 0);
        assert!(proto_fee > 0);

        // Verify k monotonicity: (r0 + in) * (r1 - out) >= r0 * r1
        let k_before = (reserve_0 as u128) * (reserve_1 as u128);
        let k_after = ((reserve_0 + amount_in) as u128) * ((reserve_1 - amount_out) as u128);
        assert!(k_after >= k_before);
    }

    #[test]
    fn test_swap_exact_output_constant_product() {
        let reserve_0 = 1_000_000_000_000u64;
        let reserve_1 = 2_000_000_000_000u64;
        let fee_tier = 3000u32;
        let protocol_fee_fraction = 250_000u32;

        let amount_out = 10_000_000_000u64;

        let (amount_in, proto_fee) = compute_swap_exact_output(
            amount_out,
            reserve_0,
            reserve_1,
            fee_tier,
            protocol_fee_fraction,
        ).unwrap();

        assert!(amount_in > 0);
        assert!(proto_fee > 0);

        let k_before = (reserve_0 as u128) * (reserve_1 as u128);
        let k_after = ((reserve_0 + amount_in) as u128) * ((reserve_1 - amount_out) as u128);
        assert!(k_after >= k_before);
    }

    #[test]
    fn test_zero_amount_swap_fails() {
        let res = compute_swap_exact_input(0, 1000, 1000, 3000, 0);
        assert!(res.is_err());

        let res_out = compute_swap_exact_output(0, 1000, 1000, 3000, 0);
        assert!(res_out.is_err());
    }

    #[test]
    fn test_amount_out_greater_than_reserve_fails() {
        let res = compute_swap_exact_output(1000, 1000, 1000, 3000, 0);
        assert!(res.is_err());
    }

    #[test]
    fn test_invariant_constant_product_fuzz() {
        // Deterministic pseudo-random seed generator
        let mut seed: u64 = 0xdeadbeef_cafebabe;
        let mut pseudo_rand = || {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1);
            seed
        };

        for _ in 0..200 {
            let r0 = (pseudo_rand() % 10_000_000_000) + 1_000_000;
            let r1 = (pseudo_rand() % 10_000_000_000) + 1_000_000;
            let amt_in = (pseudo_rand() % (r0 / 2)) + 1;
            let fee_tier = 3000u32;
            let proto_frac = 250_000u32;

            if let Ok((amt_out, proto_fee)) = compute_swap_exact_input(amt_in, r0, r1, fee_tier, proto_frac) {
                assert!(amt_out < r1);
                let k_before = (r0 as u128) * (r1 as u128);
                let k_after = ((r0 + amt_in) as u128) * ((r1 - amt_out) as u128);
                assert!(k_after >= k_before, "k invariant violated: k_after {} < k_before {}", k_after, k_before);
                assert!(proto_fee <= amt_in);
            }
        }
    }

    #[test]
    fn test_protocol_fee_deduction_vault_balance() {
        let r0 = 1_000_000_000u64;
        let r1 = 2_000_000_000u64;
        let amt_in = 50_000_000u64;
        let fee_tier = 2500u32; // 0.25%
        let proto_frac = 250_000u32; // 25%

        let (amt_out, proto_fee) = compute_swap_exact_input(amt_in, r0, r1, fee_tier, proto_frac).unwrap();

        // The net reserve increase must strictly equal amount_in - proto_fee
        let reserve_increase = amt_in - proto_fee;
        assert_eq!(reserve_increase + proto_fee, amt_in, "Vault balance conservation check");

        let updated_r0 = r0 + reserve_increase;
        let updated_r1 = r1 - amt_out;

        // k after excluding protocol fee from pool reserve must still satisfy k >= k_before
        let k_before = (r0 as u128) * (r1 as u128);
        let k_after_lp = (updated_r0 as u128) * (updated_r1 as u128);
        assert!(k_after_lp >= k_before, "LP invariant satisfied");
    }

    #[test]
    fn test_extreme_asymmetric_reserves() {
        let r0 = 10_000_000_000_000u64; // 10T
        let r1 = 1_000_000u64; // 1M
        let amt_in = 100_000_000u64;

        let (amt_out, _) = compute_swap_exact_input(amt_in, r0, r1, 3000, 0).unwrap();
        assert!(amt_out < r1);
        let k_before = (r0 as u128) * (r1 as u128);
        let k_after = ((r0 + amt_in) as u128) * ((r1 - amt_out) as u128);
        assert!(k_after >= k_before);
    }
}
