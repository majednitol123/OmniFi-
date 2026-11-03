// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title FullMath
/// @notice Facilitates multiplication and division that can have overflow of an intermediate value without loss of precision
/// @dev Handles "phantom overflow" i.e., allows multiplication and division where an intermediate value overflows 256 bits
library FullMath {
    /// @notice Calculates floor(a × b ÷ denominator) with full precision. Reverts if result overflows a uint256 or denominator == 0
    /// @param a The multiplicand
    /// @param b The multiplier
    /// @param denominator The divisor
    /// @return result The 256-bit result
    function mulDiv(uint256 a, uint256 b, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Floor);
    }

    /// @notice Calculates ceil(a × b ÷ denominator) with full precision. Reverts if result overflows a uint256 or denominator == 0
    /// @param a The multiplicand
    /// @param b The multiplier
    /// @param denominator The divisor
    /// @return result The 256-bit result
    function mulDivUp(uint256 a, uint256 b, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Ceil);
    }

    /// @notice Alias for mulDivUp
    function mulDivRoundingUp(uint256 a, uint256 b, uint256 denominator)
        internal
        pure
        returns (uint256 result)
    {
        return Math.mulDiv(a, b, denominator, Math.Rounding.Ceil);
    }
}

