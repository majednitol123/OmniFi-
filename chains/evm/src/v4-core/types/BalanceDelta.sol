// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title BalanceDelta
/// @notice Represents changes in two currency balances packed into a single int256
/// Upper 128 bits: amount0 (signed)
/// Lower 128 bits: amount1 (signed)
type BalanceDelta is int256;

using { deltaEquals as ==, deltaNotEquals as != } for BalanceDelta global;

function deltaEquals(BalanceDelta a, BalanceDelta b) pure returns (bool) {
    return BalanceDelta.unwrap(a) == BalanceDelta.unwrap(b);
}

function deltaNotEquals(BalanceDelta a, BalanceDelta b) pure returns (bool) {
    return BalanceDelta.unwrap(a) != BalanceDelta.unwrap(b);
}

library BalanceDeltaLibrary {
    function toBalanceDelta(int128 _amount0, int128 _amount1) internal pure returns (BalanceDelta) {
        int256 res;
        assembly {
            res := or(shl(128, _amount0), and(_amount1, 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF))
        }
        return BalanceDelta.wrap(res);
    }

    function amount0(BalanceDelta delta) internal pure returns (int128 _amount0) {
        assembly {
            _amount0 := sar(128, delta)
        }
    }

    function amount1(BalanceDelta delta) internal pure returns (int128 _amount1) {
        assembly {
            _amount1 := signextend(15, delta)
        }
    }
}
