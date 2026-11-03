// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { BitMath } from "../../src/clmm/libraries/BitMath.sol";

contract BitMathWrapper {
    function mostSignificantBit(uint256 x) external pure returns (uint8) {
        return BitMath.mostSignificantBit(x);
    }

    function leastSignificantBit(uint256 x) external pure returns (uint8) {
        return BitMath.leastSignificantBit(x);
    }
}

contract BitMathTest is Test {
    BitMathWrapper internal bitMath;

    function setUp() public {
        bitMath = new BitMathWrapper();
    }

    function test_MSB() public view {
        assertEq(bitMath.mostSignificantBit(1), 0);
        assertEq(bitMath.mostSignificantBit(2), 1);
        assertEq(bitMath.mostSignificantBit(3), 1);
        assertEq(bitMath.mostSignificantBit(4), 2);
        assertEq(bitMath.mostSignificantBit(1 << 100), 100);
        assertEq(bitMath.mostSignificantBit(type(uint256).max), 255);
    }

    function test_LSB() public view {
        assertEq(bitMath.leastSignificantBit(1), 0);
        assertEq(bitMath.leastSignificantBit(2), 1);
        assertEq(bitMath.leastSignificantBit(4), 2);
        assertEq(bitMath.leastSignificantBit(1 << 100), 100);
        assertEq(bitMath.leastSignificantBit((1 << 100) | (1 << 50)), 50);
        assertEq(bitMath.leastSignificantBit(type(uint256).max), 0);
    }

    function test_Zero_Reverts() public {
        vm.expectRevert(BitMath.ZeroValue.selector);
        bitMath.mostSignificantBit(0);

        vm.expectRevert(BitMath.ZeroValue.selector);
        bitMath.leastSignificantBit(0);
    }
}

