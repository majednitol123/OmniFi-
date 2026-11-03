// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Periphery Payments Interface
/// @notice Functions to ease handling of ETH and WETH in periphery contracts
interface IPeripheryPayments {
    /// @notice Unwraps the contract's WETH9 balance and sends it to recipient as ETH
    /// @param amountMinimum The minimum amount of WETH9 to unwrap
    /// @param recipient The address receiving the unwrapped ETH
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable;

    /// @notice Refunds any ETH balance held by this contract to msg.sender
    function refundETH() external payable;

    /// @notice Transfers the full balance of a token held by this contract to recipient
    /// @param token The contract address of the token which will be transferred to recipient
    /// @param amountMinimum The minimum amount of token required for a transfer
    /// @param recipient The destination address of the token
    function sweepToken(address token, uint256 amountMinimum, address recipient) external payable;
}

