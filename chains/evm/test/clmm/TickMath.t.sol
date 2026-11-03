// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";

contract TickMathWrapper {
    function getSqrtPriceAtTick(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(tick);
    }

    function getTickAtSqrtPrice(uint160 sqrtPriceX96) external pure returns (int24) {
        return TickMath.getTickAtSqrtPrice(sqrtPriceX96);
    }
}

contract TickMathTest is Test {
    TickMathWrapper internal tickMath;

    function setUp() public {
        tickMath = new TickMathWrapper();
    }

    function test_Constants() public pure {
        assertEq(TickMath.MIN_TICK, -887_272);
        assertEq(TickMath.MAX_TICK, 887_272);
        assertEq(TickMath.MIN_SQRT_PRICE, 4_295_128_739);
        assertEq(
            TickMath.MAX_SQRT_PRICE,
            1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342
        );
    }

    function test_TickToSqrtPrice_Vectors() public view {
        // Exact boundary matches
        assertEq(tickMath.getSqrtPriceAtTick(0), 79_228_162_514_264_337_593_543_950_336);
        assertEq(tickMath.getSqrtPriceAtTick(-887_272), TickMath.MIN_SQRT_PRICE);
        assertEq(tickMath.getSqrtPriceAtTick(887_272), TickMath.MAX_SQRT_PRICE);

        // Verification vs reference model (tolerance <= 1 unit in last place of 29-digit number)
        assertApproxEqAbs(tickMath.getSqrtPriceAtTick(1), 79_232_123_823_359_799_118_286_999_567, 1);
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-1), 79_224_201_403_219_477_170_569_942_573, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(60), 79_466_191_966_197_645_195_421_774_832, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-60), 78_990_846_045_029_531_151_608_375_685, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(100), 79_625_275_426_524_748_796_330_556_127, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-100), 78_833_030_112_140_176_575_862_854_578, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(200), 80_024_378_775_772_204_256_025_656_562, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-200), 78_439_868_342_809_377_387_252_074_392, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(1000), 83_290_069_058_676_223_003_182_343_269, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-1000), 75_364_347_830_767_020_784_054_125_654, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(10_000), 130_621_891_405_341_611_593_710_811_005, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-10_000), 48_055_510_970_269_007_215_549_348_796, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(23_028), 250_553_947_533_412_109_193_337_304_114, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-23_028), 25_052_894_984_021_797_146_183_221_488, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(46_054), 792_281_450_588_003_167_884_250_659_084, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(100_000), 11_755_562_826_496_067_164_730_007_768_449, 1
        );
        assertApproxEqAbs(
            tickMath.getSqrtPriceAtTick(-100_000), 533_968_626_430_936_354_154_228_407, 1
        );
    }

    function test_SqrtPriceToTick_Vectors() public view {
        assertEq(tickMath.getTickAtSqrtPrice(79_228_162_514_264_337_593_543_950_336), 0);
        assertEq(tickMath.getTickAtSqrtPrice(4_295_128_739), -887_272);

        // Round-trip verification: for any tick, getTickAtSqrtPrice(getSqrtPriceAtTick(t)) == t
        int24[15] memory testTicks = [
            int24(0),
            1,
            -1,
            60,
            -60,
            100,
            -100,
            200,
            -200,
            1000,
            -1000,
            23_028,
            -23_028,
            887_271,
            -887_272
        ];
        for (uint256 i = 0; i < testTicks.length; i++) {
            uint160 sp = tickMath.getSqrtPriceAtTick(testTicks[i]);
            assertEq(tickMath.getTickAtSqrtPrice(sp), testTicks[i]);
        }
    }

    function test_TickMath_Reverts() public {
        vm.expectRevert(TickMath.InvalidTick.selector);
        tickMath.getSqrtPriceAtTick(887_273);

        vm.expectRevert(TickMath.InvalidTick.selector);
        tickMath.getSqrtPriceAtTick(-887_273);

        vm.expectRevert(TickMath.InvalidSqrtPrice.selector);
        tickMath.getTickAtSqrtPrice(4_295_128_738);

        vm.expectRevert(TickMath.InvalidSqrtPrice.selector);
        tickMath.getTickAtSqrtPrice(TickMath.MAX_SQRT_PRICE);
    }
}
