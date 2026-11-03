// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { SwapMath } from "../../src/clmm/libraries/SwapMath.sol";

contract SwapMathWrapper {
    function computeSwapStep(
        uint160 sqrtPriceCurrentX96,
        uint160 sqrtPriceTargetX96,
        uint128 liquidity,
        int256 amountRemaining,
        uint24 feePips
    )
        external
        pure
        returns (uint160 sqrtPriceNextX96, uint256 amountIn, uint256 amountOut, uint256 feeAmount)
    {
        return SwapMath.computeSwapStep(
            sqrtPriceCurrentX96, sqrtPriceTargetX96, liquidity, amountRemaining, feePips
        );
    }
}

contract SwapMathTest is Test {
    SwapMathWrapper internal swapMath;

    function setUp() public {
        swapMath = new SwapMathWrapper();
    }

    function test_SwapStep_Typical_ZeroForOne() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint160 spTarget = 78_990_846_045_029_531_151_608_375_685;
        uint128 liquidity = 1_000_000_000_000_000_000;
        int256 amountRemaining = 1_000_000_000_000_000;
        uint24 fee = 3000;

        (uint160 spNext, uint256 aIn, uint256 aOut, uint256 feeAmount) =
            swapMath.computeSwapStep(spCurrent, spTarget, liquidity, amountRemaining, fee);

        assertEq(spNext, 79_149_250_711_305_166_342_700_278_159);
        assertEq(aIn, 997_000_000_000_000);
        assertEq(aOut, 996_006_981_039_903);
        assertEq(feeAmount, 3_000_000_000_000);
    }

    function test_SwapStep_SmallStep_NoCross() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint160 spTarget = 78_990_846_045_029_531_151_608_375_685;
        uint128 liquidity = 1_000_000_000_000_000_000;
        int256 amountRemaining = 1000;
        uint24 fee = 3000;

        (uint160 spNext, uint256 aIn, uint256 aOut, uint256 feeAmount) =
            swapMath.computeSwapStep(spCurrent, spTarget, liquidity, amountRemaining, fee);

        assertEq(spNext, 79_228_162_514_264_258_603_065_923_615);
        assertEq(aIn, 997);
        assertEq(aOut, 996);
        assertEq(feeAmount, 3);
    }

    function test_SwapStep_Typical_OneForZero() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint160 spTarget = 79_466_191_966_197_645_195_421_774_832;
        uint128 liquidity = 1_000_000_000_000_000_000;
        int256 amountRemaining = 1_000_000_000_000_000;
        uint24 fee = 3000;

        (uint160 spNext, uint256 aIn, uint256 aOut, uint256 feeAmount) =
            swapMath.computeSwapStep(spCurrent, spTarget, liquidity, amountRemaining, fee);

        assertEq(spNext, 79_307_152_992_291_059_138_124_713_654);
        assertEq(aIn, 997_000_000_000_000);
        assertEq(aOut, 996_006_981_039_903);
        assertEq(feeAmount, 3_000_000_000_000);
    }

    function test_SwapStep_Stablecoin_001pct() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint160 spTarget = 79_224_201_403_219_477_170_569_942_573;
        uint128 liquidity = 1_000_000_000_000_000_000;
        int256 amountRemaining = 1_000_000_000_000;
        uint24 fee = 100;

        (uint160 spNext, uint256 aIn, uint256 aOut, uint256 feeAmount) =
            swapMath.computeSwapStep(spCurrent, spTarget, liquidity, amountRemaining, fee);

        assertEq(spNext, 79_228_083_294_103_851_819_102_516_416);
        assertEq(aIn, 999_900_000_000);
        assertEq(aOut, 999_899_000_200);
        assertEq(feeAmount, 100_000_000);
    }

    function test_SwapStep_HighLiquidity() public view {
        uint160 spCurrent = 79_228_162_514_264_337_593_543_950_336;
        uint160 spTarget = 78_990_846_045_029_531_151_608_375_685;
        uint128 liquidity = 1_000_000_000_000_000_000_000_000;
        int256 amountRemaining = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        (uint160 spNext, uint256 aIn, uint256 aOut, uint256 feeAmount) =
            swapMath.computeSwapStep(spCurrent, spTarget, liquidity, amountRemaining, fee);

        assertEq(spNext, 79_228_083_523_865_064_300_074_843_162);
        assertEq(aIn, 997_000_000_000_000_000);
        assertEq(aOut, 996_999_005_991_991_025);
        assertEq(feeAmount, 3_000_000_000_000_000);
    }
}
