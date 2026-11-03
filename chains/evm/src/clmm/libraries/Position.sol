// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "./FullMath.sol";
import { FixedPoint128 } from "./FixedPoint128.sol";
import { LiquidityMath } from "./LiquidityMath.sol";

/// @title Position
/// @notice Positions represent an owner address' liquidity between a lower and upper tick boundary
library Position {
    error CannotUpdateEmptyPosition();

    struct Info {
        uint128 liquidity;
        uint256 feeGrowthInside0LastX128;
        uint256 feeGrowthInside1LastX128;
        uint128 tokensOwed0;
        uint128 tokensOwed1;
    }

    /// @notice Returns the Info struct of a position, given an owner and position boundaries
    /// @param self The mapping containing all positions
    /// @param owner The address of the position owner
    /// @param tickLower The lower tick boundary of the position
    /// @param tickUpper The upper tick boundary of the position
    /// @return position The position info struct of the given owners' position
    function get(
        mapping(bytes32 => Position.Info) storage self,
        address owner,
        int24 tickLower,
        int24 tickUpper
    ) internal view returns (Position.Info storage position) {
        position = self[keccak256(abi.encodePacked(owner, tickLower, tickUpper))];
    }

    /// @notice Credits accumulated fees to a user's position and updates the position's liquidity
    /// @param self The position to update
    /// @param liquidityDelta The change in pool liquidity as a result of the position update
    /// @param feeGrowthInside0X128 The all-time text0 fee growth per unit of liquidity, inside the position's tick boundaries
    /// @param feeGrowthInside1X128 The all-time text1 fee growth per unit of liquidity, inside the position's tick boundaries
    function update(
        Position.Info storage self,
        int128 liquidityDelta,
        uint256 feeGrowthInside0X128,
        uint256 feeGrowthInside1X128
    ) internal {
        uint128 _liquidity = self.liquidity;

        if (liquidityDelta == 0) {
            if (_liquidity == 0) revert CannotUpdateEmptyPosition();
        } else {
            self.liquidity = LiquidityMath.addDelta(_liquidity, liquidityDelta);
        }

        // Calculate accumulated fees
        unchecked {
            uint128 tokensOwed0 = uint128(
                FullMath.mulDiv(
                    feeGrowthInside0X128 - self.feeGrowthInside0LastX128,
                    _liquidity,
                    FixedPoint128.Q128
                )
            );
            uint128 tokensOwed1 = uint128(
                FullMath.mulDiv(
                    feeGrowthInside1X128 - self.feeGrowthInside1LastX128,
                    _liquidity,
                    FixedPoint128.Q128
                )
            );

            if (tokensOwed0 > 0 || tokensOwed1 > 0) {
                self.tokensOwed0 += tokensOwed0;
                self.tokensOwed1 += tokensOwed1;
            }
        }

        self.feeGrowthInside0LastX128 = feeGrowthInside0X128;
        self.feeGrowthInside1LastX128 = feeGrowthInside1X128;
    }
}

