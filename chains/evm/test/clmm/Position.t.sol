// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Position } from "../../src/clmm/libraries/Position.sol";

contract PositionWrapper {
    using Position for Position.Info;
    using Position for mapping(bytes32 => Position.Info);

    mapping(bytes32 => Position.Info) public positions;

    function update(
        address owner,
        int24 tickLower,
        int24 tickUpper,
        int128 liquidityDelta,
        uint256 feeGrowthInside0X128,
        uint256 feeGrowthInside1X128
    ) external {
        Position.Info storage position = positions.get(owner, tickLower, tickUpper);
        position.update(liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);
    }

    function getPosition(address owner, int24 tickLower, int24 tickUpper)
        external
        view
        returns (Position.Info memory)
    {
        return positions.get(owner, tickLower, tickUpper);
    }
}

contract PositionTest is Test {
    PositionWrapper internal wrapper;

    function setUp() public {
        wrapper = new PositionWrapper();
    }

    function test_Position_FeesOwed_Vector() public {
        address owner = address(0x123);
        int24 tickLower = -60;
        int24 tickUpper = 60;

        uint256 feeGrowthInsideLast = 500_000_000_000_000_000_000_000_000_000;
        uint256 feeGrowthInsideCurrent = 1_000_000_000_000_000_000_000_000_000_000;
        uint128 liquidity = 1_000_000_000_000_000_000;

        // Initialize position with initial fee growth
        wrapper.update(owner, tickLower, tickUpper, int128(liquidity), feeGrowthInsideLast, 0);

        // Update position at new fee growth without changing liquidity
        wrapper.update(owner, tickLower, tickUpper, 0, feeGrowthInsideCurrent, 0);

        Position.Info memory pos = wrapper.getPosition(owner, tickLower, tickUpper);

        // Expected from packages/test-vectors/clmm/vectors.json fees_owed
        assertEq(pos.tokensOwed0, 1_469_367_938);
        assertEq(pos.tokensOwed1, 0);
        assertEq(pos.liquidity, liquidity);
    }
}
