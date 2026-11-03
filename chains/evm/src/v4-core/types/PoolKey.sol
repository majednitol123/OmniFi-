// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "./Currency.sol";

/// @title PoolKey
/// @notice Uniquely identifies a concentrated liquidity pool in the singleton architecture
struct PoolKey {
    Currency currency0;
    Currency currency1;
    uint24 fee;
    int24 tickSpacing;
    address hooks;
}

