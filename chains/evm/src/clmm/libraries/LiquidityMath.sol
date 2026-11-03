// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title LiquidityMath
/// @notice Math library for liquidity operations
library LiquidityMath {
    error LiquidityOverflow();
    error LiquidityUnderflow();

    /// @notice Add a signed liquidity delta to an unsigned liquidity amount
    /// @param x The liquidity before
    /// @param y The delta to add
    /// @return z The liquidity after
    function addDelta(uint128 x, int128 y) internal pure returns (uint128 z) {
        if (y < 0) {
            uint128 absY = uint128(-y);
            if (x < absY) revert LiquidityUnderflow();
            z = x - absY;
        } else {
            unchecked {
                z = x + uint128(y);
                if (z < x) revert LiquidityOverflow();
            }
        }
    }
}
