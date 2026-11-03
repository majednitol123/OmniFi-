// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Tick } from "../../src/clmm/libraries/Tick.sol";

contract TickWrapper {
    using Tick for mapping(int24 => Tick.Info);

    mapping(int24 => Tick.Info) public ticks;

    function update(
        int24 tick,
        int24 tickCurrent,
        int128 liquidityDelta,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128,
        bool upper,
        uint128 maxLiquidity
    ) external returns (bool) {
        return ticks.update(
            tick,
            tickCurrent,
            liquidityDelta,
            feeGrowthGlobal0X128,
            feeGrowthGlobal1X128,
            upper,
            maxLiquidity
        );
    }

    function cross(int24 tick, uint256 feeGrowthGlobal0X128, uint256 feeGrowthGlobal1X128)
        external
        returns (int128)
    {
        return ticks.cross(tick, feeGrowthGlobal0X128, feeGrowthGlobal1X128);
    }

    function getFeeGrowthInside(
        int24 tickLower,
        int24 tickUpper,
        int24 tickCurrent,
        uint256 feeGrowthGlobal0X128,
        uint256 feeGrowthGlobal1X128
    ) external view returns (uint256, uint256) {
        return ticks.getFeeGrowthInside(
            tickLower, tickUpper, tickCurrent, feeGrowthGlobal0X128, feeGrowthGlobal1X128
        );
    }

    function setFeeGrowthOutside(int24 tick, uint256 feeGrowthOutside0, uint256 feeGrowthOutside1)
        external
    {
        ticks[tick].feeGrowthOutside0X128 = feeGrowthOutside0;
        ticks[tick].feeGrowthOutside1X128 = feeGrowthOutside1;
        ticks[tick].initialized = true;
    }
}

contract TickTest is Test {
    TickWrapper internal wrapper;

    function setUp() public {
        wrapper = new TickWrapper();
    }

    function test_Tick_Update_And_Flip() public {
        uint128 maxL = type(uint128).max;
        // Mint lower tick: flips to true
        bool flipped = wrapper.update(-60, 0, 1000, 0, 0, false, maxL);
        assertTrue(flipped);

        // Additional mint: does not flip
        flipped = wrapper.update(-60, 0, 500, 0, 0, false, maxL);
        assertFalse(flipped);

        // Burn back: flips when hitting 0
        flipped = wrapper.update(-60, 0, -1500, 0, 0, false, maxL);
        assertTrue(flipped);
    }

    function test_Tick_FeeGrowthInside_Vector() public {
        // From packages/test-vectors/clmm/vectors.json fee_growth_inside
        uint256 feeGrowthGlobal = 1_000_000_000_000_000_000_000_000_000_000;
        uint256 feeGrowthOutsideLower = 10_000_000_000_000_000_000_000_000_000;
        uint256 feeGrowthOutsideUpper = 20_000_000_000_000_000_000_000_000_000;
        int24 tickLower = -60;
        int24 tickUpper = 60;
        int24 tickCurrent = 0;

        wrapper.setFeeGrowthOutside(tickLower, feeGrowthOutsideLower, 0);
        wrapper.setFeeGrowthOutside(tickUpper, feeGrowthOutsideUpper, 0);

        (uint256 inside0,) =
            wrapper.getFeeGrowthInside(tickLower, tickUpper, tickCurrent, feeGrowthGlobal, 0);

        assertEq(inside0, 970_000_000_000_000_000_000_000_000_000);
    }
}
