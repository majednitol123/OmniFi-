// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { TickBitmap } from "../../src/clmm/libraries/TickBitmap.sol";

contract TickBitmapWrapper {
    using TickBitmap for mapping(int16 => uint256);

    mapping(int16 => uint256) public bitmap;

    function flipTick(int24 tick, int24 tickSpacing) external {
        bitmap.flipTick(tick, tickSpacing);
    }

    function nextInitializedTickWithinOneWord(int24 tick, int24 tickSpacing, bool lte)
        external
        view
        returns (int24 next, bool initialized)
    {
        return bitmap.nextInitializedTickWithinOneWord(tick, tickSpacing, lte);
    }
}

contract TickBitmapTest is Test {
    TickBitmapWrapper internal wrapper;

    function setUp() public {
        wrapper = new TickBitmapWrapper();
    }

    function test_FlipTick_And_Search_LTE() public {
        int24 tickSpacing = 60;
        wrapper.flipTick(0, tickSpacing);
        wrapper.flipTick(120, tickSpacing);

        // Searching LTE from 60 in word 0: should find 0
        (int24 next, bool init) = wrapper.nextInitializedTickWithinOneWord(60, tickSpacing, true);
        assertTrue(init);
        assertEq(next, 0);

        // Searching LTE from 120 in word 0: should find 120
        (next, init) = wrapper.nextInitializedTickWithinOneWord(120, tickSpacing, true);
        assertTrue(init);
        assertEq(next, 120);

        // Searching in word -1 where tick -60 is flipped
        wrapper.flipTick(-60, tickSpacing);
        (next, init) = wrapper.nextInitializedTickWithinOneWord(-60, tickSpacing, true);
        assertTrue(init);
        assertEq(next, -60);
    }

    function test_FlipTick_And_Search_GT() public {
        int24 tickSpacing = 60;
        wrapper.flipTick(120, tickSpacing);
        wrapper.flipTick(240, tickSpacing);

        // Searching GT from 0: should find 120
        (int24 next, bool init) = wrapper.nextInitializedTickWithinOneWord(0, tickSpacing, false);
        assertTrue(init);
        assertEq(next, 120);

        // Searching GT from 120: should find 240
        (next, init) = wrapper.nextInitializedTickWithinOneWord(120, tickSpacing, false);
        assertTrue(init);
        assertEq(next, 240);
    }
}
