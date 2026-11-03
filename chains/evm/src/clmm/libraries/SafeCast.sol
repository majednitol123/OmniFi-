// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title SafeCast
/// @notice Contains methods for safely casting between integer types with overflow checks
library SafeCast {
    error SafeCastOverflow();

    /// @notice Cast a uint256 to a uint160, revert on overflow
    function toUint160(uint256 y) internal pure returns (uint160 z) {
        if ((z = uint160(y)) != y) revert SafeCastOverflow();
    }

    /// @notice Cast a uint256 to a uint128, revert on overflow
    function toUint128(uint256 y) internal pure returns (uint128 z) {
        if ((z = uint128(y)) != y) revert SafeCastOverflow();
    }

    /// @notice Cast a uint256 to an int256, revert on overflow
    function toInt256(uint256 y) internal pure returns (int256 z) {
        if (y > uint256(type(int256).max)) revert SafeCastOverflow();
        z = int256(y);
    }

    /// @notice Cast an int256 to an int128, revert on overflow or underflow
    function toInt128(int256 y) internal pure returns (int128 z) {
        if (y < type(int128).min || y > type(int128).max) revert SafeCastOverflow();
        z = int128(y);
    }
}

