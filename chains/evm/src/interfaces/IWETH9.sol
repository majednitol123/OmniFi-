// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "./IERC20Minimal.sol";

/// @title Interface for WETH9
/// @notice Standard interface for Canonical Wrapped Ether (WETH9)
interface IWETH9 is IERC20Minimal {
    /// @notice Deposits ETH into the contract and mints WETH9
    function deposit() external payable;

    /// @notice Burns WETH9 and withdraws ETH to the caller
    /// @param wad The amount of WETH9 to burn
    function withdraw(uint256 wad) external;
}

