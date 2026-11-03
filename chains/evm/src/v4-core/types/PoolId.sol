// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { PoolKey } from "./PoolKey.sol";

/// @title PoolId
/// @notice 32-byte identifier computed from a PoolKey
type PoolId is bytes32;

using { idEquals as ==, idNotEquals as != } for PoolId global;

function idEquals(PoolId a, PoolId b) pure returns (bool) {
    return PoolId.unwrap(a) == PoolId.unwrap(b);
}

function idNotEquals(PoolId a, PoolId b) pure returns (bool) {
    return PoolId.unwrap(a) != PoolId.unwrap(b);
}

library PoolIdLibrary {
    function toId(PoolKey memory poolKey) internal pure returns (PoolId) {
        return PoolId.wrap(keccak256(abi.encode(poolKey)));
    }
}
