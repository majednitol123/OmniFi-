// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { SqrtPriceMath } from "../../src/clmm/libraries/SqrtPriceMath.sol";
import { SwapMath } from "../../src/clmm/libraries/SwapMath.sol";
import { LiquidityAmounts } from "../../src/clmm/libraries/LiquidityAmounts.sol";
import { FullMath } from "../../src/clmm/libraries/FullMath.sol";
import { FixedPoint128 } from "../../src/clmm/libraries/FixedPoint128.sol";
import { Tick } from "../../src/clmm/libraries/Tick.sol";
import { Position } from "../../src/clmm/libraries/Position.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { CLMMTestHelper } from "../helpers/CLMMTestHelper.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

/// @title CLMM Differential Testing against packages/test-vectors/clmm/vectors.json
contract CLMMDifferentialTest is Test {
    using Position for Position.Info;
    using Position for mapping(bytes32 => Position.Info);
    using Tick for mapping(int24 => Tick.Info);

    mapping(int24 => Tick.Info) internal ticks;
    mapping(bytes32 => Position.Info) internal positions;

    // --- Vector Group 1: Tick to SqrtPrice (20 test vectors) ---
    function test_Differential_TickToSqrtPrice() public pure {
        // [0] tick: 0
        assertEq(TickMath.getSqrtPriceAtTick(0), 79_228_162_514_264_337_593_543_950_336);
        // [1] tick: 1 (tolerance <= 1 wei vs Python Decimal floor)
        assertApproxEqAbs(TickMath.getSqrtPriceAtTick(1), 79_232_123_823_359_799_118_286_999_567, 1);
        // [2] tick: -1
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-1), 79_224_201_403_219_477_170_569_942_573, 1
        );
        // [3] tick: 100
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(100), 79_625_275_426_524_748_796_330_556_127, 1
        );
        // [4] tick: -100
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-100), 78_833_030_112_140_176_575_862_854_578, 1
        );
        // [5] tick: 887272 (MAX_SQRT_PRICE)
        assertEq(TickMath.getSqrtPriceAtTick(887_272), TickMath.MAX_SQRT_PRICE);
        // [6] tick: -887272
        assertEq(TickMath.getSqrtPriceAtTick(-887_272), 4_295_128_739);
        // [7] tick: 60
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(60), 79_466_191_966_197_645_195_421_774_832, 1
        );
        // [8] tick: -60
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-60), 78_990_846_045_029_531_151_608_375_685, 1
        );
        // [9] tick: 23028
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(23_028), 250_553_947_533_412_109_193_337_304_114, 1
        );
        // [10] tick: -23028
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-23_028), 25_052_894_984_021_797_146_183_221_488, 1
        );
        // [11] tick: 46054
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(46_054), 792_281_450_588_003_167_884_250_659_084, 1
        );
        // [12] tick: 200
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(200), 80_024_378_775_772_204_256_025_656_562, 1
        );
        // [13] tick: -200
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-200), 78_439_868_342_809_377_387_252_074_392, 1
        );
        // [14] tick: 1000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(1000), 83_290_069_058_676_223_003_182_343_269, 1
        );
        // [15] tick: -1000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-1000), 75_364_347_830_767_020_784_054_125_654, 1
        );
        // [16] tick: 10000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(10_000), 130_621_891_405_341_611_593_710_811_005, 1
        );
        // [17] tick: -10000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-10_000), 48_055_510_970_269_007_215_549_348_796, 1
        );
        // [18] tick: 100000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(100_000), 11_755_562_826_496_067_164_730_007_768_449, 1
        );
        // [19] tick: -100000
        assertApproxEqAbs(
            TickMath.getSqrtPriceAtTick(-100_000), 533_968_626_430_936_354_154_228_407, 1
        );
    }

    // --- Vector Group 2: SqrtPrice to Tick (7 test vectors) ---
    function test_Differential_SqrtPriceToTick() public pure {
        assertEq(TickMath.getTickAtSqrtPrice(79_228_162_514_264_337_593_543_950_336), 0);
        assertApproxEqAbs(
            TickMath.getTickAtSqrtPrice(79_625_275_426_524_748_796_330_556_127), 100, 1
        );
        assertApproxEqAbs(
            TickMath.getTickAtSqrtPrice(78_833_030_112_140_176_575_862_854_578), -100, 1
        );
        assertApproxEqAbs(
            TickMath.getTickAtSqrtPrice(79_466_191_966_197_645_195_421_774_832), 60, 1
        );
        assertApproxEqAbs(
            TickMath.getTickAtSqrtPrice(250_553_947_533_412_109_193_337_304_114), 23_028, 1
        );
        assertEq(TickMath.getTickAtSqrtPrice(4_295_128_739), -887_272);
        assertApproxEqAbs(
            TickMath.getTickAtSqrtPrice(
                1_461_446_703_485_210_103_244_672_773_810_124_308_346_321_380_902
            ),
            887_272,
            1
        );
    }

    // --- Vector Group 3: Swap Step Vectors (5 test vectors) ---
    function test_Differential_SwapSteps() public pure {
        // Step 1: typical_step_0.30pct_zeroForOne
        {
            (uint160 sqrtPNext, uint256 amountIn, uint256 amountOut, uint256 feeAmount) = SwapMath.computeSwapStep(
                79_228_162_514_264_337_593_543_950_336,
                78_990_846_045_029_531_151_608_375_685,
                1_000_000_000_000_000_000,
                1_000_000_000_000_000,
                3000
            );
            assertEq(sqrtPNext, 79_149_250_711_305_166_342_700_278_159);
            assertEq(amountIn, 997_000_000_000_000);
            assertEq(amountOut, 996_006_981_039_903);
            assertEq(feeAmount, 3_000_000_000_000);
        }

        // Step 2: small_step_no_cross
        {
            (uint160 sqrtPNext, uint256 amountIn, uint256 amountOut, uint256 feeAmount) = SwapMath.computeSwapStep(
                79_228_162_514_264_337_593_543_950_336,
                78_990_846_045_029_531_151_608_375_685,
                1_000_000_000_000_000_000,
                1000,
                3000
            );
            assertEq(sqrtPNext, 79_228_162_514_264_258_603_065_923_615);
            assertEq(amountIn, 997);
            assertEq(amountOut, 996);
            assertEq(feeAmount, 3);
        }

        // Step 3: typical_step_0.30pct_oneForZero
        {
            (uint160 sqrtPNext, uint256 amountIn, uint256 amountOut, uint256 feeAmount) = SwapMath.computeSwapStep(
                79_228_162_514_264_337_593_543_950_336,
                79_466_191_966_197_645_195_421_774_832,
                1_000_000_000_000_000_000,
                1_000_000_000_000_000,
                3000
            );
            assertEq(sqrtPNext, 79_307_152_992_291_059_138_124_713_654);
            assertEq(amountIn, 997_000_000_000_000);
            assertEq(amountOut, 996_006_981_039_903);
            assertEq(feeAmount, 3_000_000_000_000);
        }

        // Step 4: stablecoin_step_0.01pct
        {
            (uint160 sqrtPNext, uint256 amountIn, uint256 amountOut, uint256 feeAmount) = SwapMath.computeSwapStep(
                79_228_162_514_264_337_593_543_950_336,
                79_224_201_403_219_477_170_569_942_573,
                1_000_000_000_000_000_000,
                1_000_000_000_000,
                100
            );
            assertEq(sqrtPNext, 79_228_083_294_103_851_819_102_516_416);
            assertEq(amountIn, 999_900_000_000);
            assertEq(amountOut, 999_899_000_200);
            assertEq(feeAmount, 100_000_000);
        }

        // Step 5: high_liquidity_step
        {
            (uint160 sqrtPNext, uint256 amountIn, uint256 amountOut, uint256 feeAmount) = SwapMath.computeSwapStep(
                79_228_162_514_264_337_593_543_950_336,
                78_990_846_045_029_531_151_608_375_685,
                1_000_000_000_000_000_000_000_000,
                1_000_000_000_000_000_000,
                3000
            );
            assertEq(sqrtPNext, 79_228_083_523_865_064_300_074_843_162);
            assertEq(amountIn, 997_000_000_000_000_000);
            assertEq(amountOut, 996_999_005_991_991_025);
            assertEq(feeAmount, 3_000_000_000_000_000);
        }
    }

    // --- Vector Group 4: Amount Calculations (5 test vectors) ---
    function test_Differential_AmountCalculations() public pure {
        // narrow_range_at_parity
        {
            uint160 pLower = 78_990_846_045_029_531_151_608_375_685;
            uint160 pUpper = 79_466_191_966_197_645_195_421_774_832;
            uint128 L = 1_000_000_000_000_000_000;
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, false), 5_999_709_018_652_706);
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, true), 5_999_709_018_652_707);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, false), 5_999_709_018_652_706);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, true), 5_999_709_018_652_707);
        }

        // full_range
        {
            uint160 pLower = 4_306_310_043;
            uint160 pUpper = 1_457_652_066_949_847_389_937_902_910_258_958_406_565_750_968_362;
            uint128 L = 1_000_000_000_000_000_000;
            assertEq(
                SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, false),
                18_398_155_665_324_522_383_337_355_613_621_339_061
            );
            assertEq(
                SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, true),
                18_398_155_665_324_522_383_337_355_613_621_339_062
            );
            assertEq(
                SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, false),
                18_398_155_664_501_368_265_872_409_502_727_663_969
            );
            assertEq(
                SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, true),
                18_398_155_664_501_368_265_872_409_502_727_663_970
            );
        }

        // out_of_range_above
        {
            uint160 pLower = 250_203_434_948_259_642_083_317_319_083;
            uint160 pUpper = 251_457_522_024_833_871_755_803_350_098;
            uint128 L = 1_000_000_000_000_000;
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, false), 1_579_244_514_392);
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, true), 1_579_244_514_393);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, false), 15_828_804_263_237);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, true), 15_828_804_263_238);
        }

        // out_of_range_below
        {
            uint160 pLower = 78_833_030_112_140_176_575_862_854_578;
            uint160 pUpper = 78_990_846_045_029_531_151_608_375_685;
            uint128 L = 1_000_000_000_000_000;
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, false), 2_007_915_560_309);
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, true), 2_007_915_560_310);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, false), 1_991_917_114_838);
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, true), 1_991_917_114_839);
        }

        // wide_range
        {
            uint160 pLower = 76_886_731_765_546_235_930_195_592_749;
            uint160 pUpper = 81_640_896_826_356_156_310_682_304_525;
            uint128 L = 1_000_000_000_000_000_000;
            assertEq(
                SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, false), 60_005_999_255_049_926
            );
            assertEq(SqrtPriceMath.getAmount0Delta(pLower, pUpper, L, true), 60_005_999_255_049_927);
            assertEq(
                SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, false), 60_005_999_255_049_926
            );
            assertEq(SqrtPriceMath.getAmount1Delta(pLower, pUpper, L, true), 60_005_999_255_049_927);
        }
    }

    // --- Vector Group 5: Mint Positions (Liquidity Amounts) ---
    function test_Differential_MintPositions() public pure {
        uint160 pCurrent = 79_228_162_514_264_337_593_543_950_336; // tick 0

        // 1. in_range_parity_0.30pct (tick -60 to 60)
        {
            uint160 pLower = TickMath.getSqrtPriceAtTick(-60);
            uint160 pUpper = TickMath.getSqrtPriceAtTick(60);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                pCurrent, pLower, pUpper, 1_000_000_000_000_000_000, 1_000_000_000_000_000_000
            );
            assertEq(L, 333_850_249_709_699_449_134);
        }

        // 2. wide_range_parity (tick -600 to 600)
        {
            uint160 pLower = TickMath.getSqrtPriceAtTick(-600);
            uint160 pUpper = TickMath.getSqrtPriceAtTick(600);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                pCurrent, pLower, pUpper, 1_000_000_000_000_000_000, 1_000_000_000_000_000_000
            );
            assertEq(L, 33_837_499_809_738_371_427);
        }

        // 3. above_range_token0_only (tick 120 to 240)
        {
            uint160 pLower = TickMath.getSqrtPriceAtTick(120);
            uint160 pUpper = TickMath.getSqrtPriceAtTick(240);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                pCurrent, pLower, pUpper, 1_000_000_000_000_000_000, 0
            );
            assertEq(L, 168_181_517_570_088_585_074);
        }

        // 4. below_range_token1_only (tick -240 to -120)
        {
            uint160 pLower = TickMath.getSqrtPriceAtTick(-240);
            uint160 pUpper = TickMath.getSqrtPriceAtTick(-120);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                pCurrent, pLower, pUpper, 0, 1_000_000_000_000_000_000
            );
            assertEq(L, 168_181_517_570_088_585_074);
        }

        // 5. tight_range_stablecoin (tick -1 to 1)
        {
            uint160 pLower = TickMath.getSqrtPriceAtTick(-1);
            uint160 pUpper = TickMath.getSqrtPriceAtTick(1);
            uint128 L = LiquidityAmounts.getLiquidityForAmounts(
                pCurrent, pLower, pUpper, 1_000_000_000_000_000_000, 1_000_000_000_000_000_000
            );
            assertEq(L, 20_001_499_987_500_624_960_940);
        }
    }

    // --- Vector Group 6: Fee Growth Vectors ---
    function test_Differential_FeeGrowth() public {
        // 1. basic_fee_growth: fee=1e15, L=1e18 -> delta = fee * 2^128 / L
        uint256 feeDelta =
            FullMath.mulDiv(1_000_000_000_000_000, FixedPoint128.Q128, 1_000_000_000_000_000_000);
        assertEq(feeDelta, 340_282_366_920_938_463_463_374_607_431_768_211);

        // 2. small_fee_high_liquidity: fee=100, L=1e24
        uint256 feeDeltaSmall =
            FullMath.mulDiv(100, FixedPoint128.Q128, 1_000_000_000_000_000_000_000_000);
        assertEq(feeDeltaSmall, 34_028_236_692_093_846);

        // 3. fee_growth_inside
        ticks[-60].feeGrowthOutside0X128 = 10_000_000_000_000_000_000_000_000_000;
        ticks[60].feeGrowthOutside0X128 = 20_000_000_000_000_000_000_000_000_000;
        (uint256 fgInside0,) =
            ticks.getFeeGrowthInside(-60, 60, 0, 1_000_000_000_000_000_000_000_000_000_000, 0);
        assertEq(fgInside0, 970_000_000_000_000_000_000_000_000_000);

        // 4. fees_owed
        address owner = address(0x123);
        int24 tickLower = -60;
        int24 tickUpper = 60;
        Position.Info storage pos = positions.get(owner, tickLower, tickUpper);
        pos.update(int128(1_000_000_000_000_000_000), 500_000_000_000_000_000_000_000_000_000, 0);
        pos.update(0, 1_000_000_000_000_000_000_000_000_000_000, 0);
        assertEq(pos.tokensOwed0, 1_469_367_938);
    }

    // --- Vector Group 7: End-to-End Pool Execution vs Test Vectors ---
    function test_Differential_Pool_SwapExecution() public {
        OmniFiPoolFactory factory = new OmniFiPoolFactory(address(this), address(this));

        MockERC20 t0 = new MockERC20("Token 0", "TK0", 18);
        MockERC20 t1 = new MockERC20("Token 1", "TK1", 18);
        if (address(t0) > address(t1)) {
            (t0, t1) = (t1, t0);
        }

        address poolAddress = factory.createPool(address(t0), address(t1), 3000);
        IOmniFiPool pool = IOmniFiPool(poolAddress);
        pool.initialize(TickMath.getSqrtPriceAtTick(0));

        CLMMTestHelper helper = new CLMMTestHelper(address(t0), address(t1));
        t0.mint(address(helper), 100 ether);
        t1.mint(address(helper), 100 ether);

        // Mint position: range [-60, 60] with 1e18 liquidity
        // At tick 0 (parity), amount0 from [0, 60] is 2995354955910781, and amount1 from [-60, 0] is 2995354955910781
        vm.prank(address(helper));
        (uint256 a0Mint, uint256 a1Mint) =
            pool.mint(address(helper), -60, 60, 1_000_000_000_000_000_000, "");
        assertEq(a0Mint, 2_995_354_955_910_781);
        assertEq(a1Mint, 2_995_354_955_910_781);

        // Swap typical_step_0.30pct_zeroForOne:
        // amount_remaining = 1000000000000000 (1e15)
        // expected: amount_out = 996006981039903
        vm.prank(address(helper));
        (int256 a0Swap, int256 a1Swap) = pool.swap(
            address(helper),
            true, // zeroForOne
            1_000_000_000_000_000,
            TickMath.MIN_SQRT_PRICE + 1,
            ""
        );

        assertEq(a0Swap, 1_000_000_000_000_000);
        assertEq(uint256(-a1Swap), 996_006_981_039_903);
    }
}
