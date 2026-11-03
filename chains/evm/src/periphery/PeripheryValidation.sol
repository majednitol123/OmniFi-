// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Periphery Validation
/// @notice Functions and modifiers for validating transaction deadlines and parameters
abstract contract PeripheryValidation {
    error TransactionExpired();

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionExpired();
        _;
    }
}

