// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IWETH9 } from "../interfaces/IWETH9.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { IPeripheryPayments } from "../interfaces/IPeripheryPayments.sol";
import { TransferHelper } from "../v2/libraries/TransferHelper.sol";

/// @title Periphery Payments
/// @notice Functions to ease handling of ETH and WETH in periphery contracts
abstract contract PeripheryPayments is IPeripheryPayments {
    error InsufficientOutput();
    error NotWETH9();

    address public immutable WETH9;

    constructor(address _WETH9) {
        WETH9 = _WETH9;
    }

    /// @notice Allows the contract to receive ETH from WETH9 unwraps
    receive() external payable virtual {
        if (msg.sender != WETH9) revert NotWETH9();
    }

    /// @inheritdoc IPeripheryPayments
    function unwrapWETH9(uint256 amountMinimum, address recipient) external payable override {
        uint256 balanceWETH9 = IWETH9(WETH9).balanceOf(address(this));
        if (balanceWETH9 < amountMinimum) revert InsufficientOutput();

        if (balanceWETH9 > 0) {
            IWETH9(WETH9).withdraw(balanceWETH9);
            TransferHelper.safeTransferETH(recipient, balanceWETH9);
        }
    }

    /// @inheritdoc IPeripheryPayments
    function refundETH() external payable override {
        if (address(this).balance > 0) {
            TransferHelper.safeTransferETH(msg.sender, address(this).balance);
        }
    }

    /// @inheritdoc IPeripheryPayments
    function sweepToken(address token, uint256 amountMinimum, address recipient) external payable override {
        uint256 balanceToken = IERC20Minimal(token).balanceOf(address(this));
        if (balanceToken < amountMinimum) revert InsufficientOutput();

        if (balanceToken > 0) {
            TransferHelper.safeTransfer(token, recipient, balanceToken);
        }
    }
}

