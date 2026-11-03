// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { FullMath } from "../../src/clmm/libraries/FullMath.sol";
import { SafeCast } from "../../src/clmm/libraries/SafeCast.sol";
import { LiquidityMath } from "../../src/clmm/libraries/LiquidityMath.sol";
import { FixedPoint96 } from "../../src/clmm/libraries/FixedPoint96.sol";

contract SafeCastWrapper {
    function toUint160(uint256 y) external pure returns (uint160) {
        return SafeCast.toUint160(y);
    }

    function toUint128(uint256 y) external pure returns (uint128) {
        return SafeCast.toUint128(y);
    }

    function toInt256(uint256 y) external pure returns (int256) {
        return SafeCast.toInt256(y);
    }

    function toInt128(int256 y) external pure returns (int128) {
        return SafeCast.toInt128(y);
    }
}

contract LiquidityMathWrapper {
    function addDelta(uint128 x, int128 y) external pure returns (uint128) {
        return LiquidityMath.addDelta(x, y);
    }
}

contract FullMathTest is Test {
    SafeCastWrapper internal safeCast;
    LiquidityMathWrapper internal liquidityMath;

    function setUp() public {
        safeCast = new SafeCastWrapper();
        liquidityMath = new LiquidityMathWrapper();
    }

    function test_MulDiv_Basic() public pure {
        uint256 res = FullMath.mulDiv(10, 20, 5);
        assertEq(res, 40);
    }

    function test_MulDiv_PhantomOverflow() public pure {
        // Intermediate product exceeds 2^256 - 1, but result fits in uint256
        uint256 a = 1 << 200;
        uint256 b = 1 << 100;
        uint256 d = 1 << 150;
        uint256 res = FullMath.mulDiv(a, b, d);
        assertEq(res, 1 << 150);
    }

    function test_MulDiv_RoundingDown() public pure {
        uint256 res = FullMath.mulDiv(10, 10, 3);
        assertEq(res, 33);
    }

    function test_MulDivUp_RoundingUp() public pure {
        uint256 res = FullMath.mulDivUp(10, 10, 3);
        assertEq(res, 34);

        // Exact division should not round up
        uint256 resExact = FullMath.mulDivUp(10, 10, 5);
        assertEq(resExact, 20);
    }

    function test_SafeCast() public {
        assertEq(safeCast.toUint160(12_345), 12_345);
        assertEq(safeCast.toUint128(67_890), 67_890);
        assertEq(safeCast.toInt256(100), 100);
        assertEq(safeCast.toInt128(200), 200);

        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        safeCast.toUint160(uint256(type(uint160).max) + 1);

        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        safeCast.toUint128(uint256(type(uint128).max) + 1);

        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        safeCast.toInt256(uint256(type(int256).max) + 1);

        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        safeCast.toInt128(int256(type(int128).max) + 1);

        vm.expectRevert(SafeCast.SafeCastOverflow.selector);
        safeCast.toInt128(int256(type(int128).min) - 1);
    }

    function test_LiquidityMath_AddDelta() public {
        uint128 l = 1000;
        assertEq(liquidityMath.addDelta(l, 500), 1500);
        assertEq(liquidityMath.addDelta(l, -500), 500);
        assertEq(liquidityMath.addDelta(l, 0), 1000);

        vm.expectRevert(LiquidityMath.LiquidityUnderflow.selector);
        liquidityMath.addDelta(l, -1001);

        vm.expectRevert(LiquidityMath.LiquidityOverflow.selector);
        liquidityMath.addDelta(type(uint128).max, 1);
    }

    function test_FixedPoint96() public pure {
        assertEq(FixedPoint96.Q96, 79_228_162_514_264_337_593_543_950_336);
        assertEq(FixedPoint96.RESOLUTION, 96);
    }
}
