// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { SqrtPriceMath } from "../../src/clmm/libraries/SqrtPriceMath.sol";

contract SqrtPriceMathWrapper {
    function getAmount0Delta(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint128 liquidity,
        bool roundUp
    ) external pure returns (uint256) {
        return SqrtPriceMath.getAmount0Delta(sqrtPriceAX96, sqrtPriceBX96, liquidity, roundUp);
    }

    function getAmount1Delta(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint128 liquidity,
        bool roundUp
    ) external pure returns (uint256) {
        return SqrtPriceMath.getAmount1Delta(sqrtPriceAX96, sqrtPriceBX96, liquidity, roundUp);
    }

    function getAmount0DeltaSigned(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, int128 liquidity)
        external
        pure
        returns (int256)
    {
        return SqrtPriceMath.getAmount0Delta(sqrtPriceAX96, sqrtPriceBX96, liquidity);
    }

    function getAmount1DeltaSigned(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, int128 liquidity)
        external
        pure
        returns (int256)
    {
        return SqrtPriceMath.getAmount1Delta(sqrtPriceAX96, sqrtPriceBX96, liquidity);
    }

    function getNextSqrtPriceFromInput(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) external pure returns (uint160) {
        return SqrtPriceMath.getNextSqrtPriceFromInput(
            sqrtPriceX96, liquidity, amountIn, zeroForOne
        );
    }

    function getNextSqrtPriceFromOutput(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) external pure returns (uint160) {
        return SqrtPriceMath.getNextSqrtPriceFromOutput(
            sqrtPriceX96, liquidity, amountOut, zeroForOne
        );
    }
}

contract SqrtPriceMathTest is Test {
    SqrtPriceMathWrapper internal sqrtPriceMath;

    function setUp() public {
        sqrtPriceMath = new SqrtPriceMathWrapper();
    }

    function test_AmountCalculations_NarrowRangeAtParity() public view {
        uint160 spL = 78_990_846_045_029_531_151_608_375_685;
        uint160 spU = 79_466_191_966_197_645_195_421_774_832;
        uint128 L = 1_000_000_000_000_000_000;

        uint256 a0Down = sqrtPriceMath.getAmount0Delta(spL, spU, L, false);
        uint256 a0Up = sqrtPriceMath.getAmount0Delta(spL, spU, L, true);
        uint256 a1Down = sqrtPriceMath.getAmount1Delta(spL, spU, L, false);
        uint256 a1Up = sqrtPriceMath.getAmount1Delta(spL, spU, L, true);

        assertEq(a0Down, 5_999_709_018_652_706);
        assertEq(a0Up, 5_999_709_018_652_707);
        assertEq(a1Down, 5_999_709_018_652_706);
        assertEq(a1Up, 5_999_709_018_652_707);
    }

    function test_AmountCalculations_OutOfRangeAbove() public view {
        uint160 spL = 250_203_434_948_259_642_083_317_319_083;
        uint160 spU = 251_457_522_024_833_871_755_803_350_098;
        uint128 L = 1_000_000_000_000_000;

        uint256 a0Down = sqrtPriceMath.getAmount0Delta(spL, spU, L, false);
        uint256 a0Up = sqrtPriceMath.getAmount0Delta(spL, spU, L, true);
        uint256 a1Down = sqrtPriceMath.getAmount1Delta(spL, spU, L, false);
        uint256 a1Up = sqrtPriceMath.getAmount1Delta(spL, spU, L, true);

        assertEq(a0Down, 1_579_244_514_392);
        assertEq(a0Up, 1_579_244_514_393);
        assertEq(a1Down, 15_828_804_263_237);
        assertEq(a1Up, 15_828_804_263_238);
    }

    function test_AmountCalculations_OutOfRangeBelow() public view {
        uint160 spL = 78_833_030_112_140_176_575_862_854_578;
        uint160 spU = 78_990_846_045_029_531_151_608_375_685;
        uint128 L = 1_000_000_000_000_000;

        uint256 a0Down = sqrtPriceMath.getAmount0Delta(spL, spU, L, false);
        uint256 a0Up = sqrtPriceMath.getAmount0Delta(spL, spU, L, true);
        uint256 a1Down = sqrtPriceMath.getAmount1Delta(spL, spU, L, false);
        uint256 a1Up = sqrtPriceMath.getAmount1Delta(spL, spU, L, true);

        assertEq(a0Down, 2_007_915_560_309);
        assertEq(a0Up, 2_007_915_560_310);
        assertEq(a1Down, 1_991_917_114_838);
        assertEq(a1Up, 1_991_917_114_839);
    }

    function test_AmountCalculations_WideRange() public view {
        uint160 spL = 76_886_731_765_546_235_930_195_592_749;
        uint160 spU = 81_640_896_826_356_156_310_682_304_525;
        uint128 L = 1_000_000_000_000_000_000;

        uint256 a0Down = sqrtPriceMath.getAmount0Delta(spL, spU, L, false);
        uint256 a0Up = sqrtPriceMath.getAmount0Delta(spL, spU, L, true);
        uint256 a1Down = sqrtPriceMath.getAmount1Delta(spL, spU, L, false);
        uint256 a1Up = sqrtPriceMath.getAmount1Delta(spL, spU, L, true);

        assertEq(a0Down, 60_005_999_255_049_926);
        assertEq(a0Up, 60_005_999_255_049_927);
        assertEq(a1Down, 60_005_999_255_049_926);
        assertEq(a1Up, 60_005_999_255_049_927);
    }

    function test_SignedDeltas() public view {
        uint160 spL = 78_990_846_045_029_531_151_608_375_685;
        uint160 spU = 79_466_191_966_197_645_195_421_774_832;

        int256 a0Positive =
            sqrtPriceMath.getAmount0DeltaSigned(spL, spU, int128(1_000_000_000_000_000_000));
        int256 a0Negative =
            sqrtPriceMath.getAmount0DeltaSigned(spL, spU, -int128(1_000_000_000_000_000_000));

        assertEq(a0Positive, 5_999_709_018_652_707); // Rounded UP
        assertEq(a0Negative, -5_999_709_018_652_706); // Rounded DOWN
    }

    function test_NextSqrtPrice_InputOutput() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint128 L = 1_000_000_000_000_000_000;
        uint256 amountIn = 1_000_000_000_000_000;

        // token0 in -> price decreases
        uint160 nextSp0 = sqrtPriceMath.getNextSqrtPriceFromInput(spCurrent, L, amountIn, true);
        assertTrue(nextSp0 < spCurrent);

        // token1 in -> price increases
        uint160 nextSp1 = sqrtPriceMath.getNextSqrtPriceFromInput(spCurrent, L, amountIn, false);
        assertTrue(nextSp1 > spCurrent);
    }
}
