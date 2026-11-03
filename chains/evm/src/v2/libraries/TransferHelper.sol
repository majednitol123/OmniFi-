// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title TransferHelper
/// @notice Safe helper for calling ERC-20 transfer, transferFrom, and approve with return-value handling
library TransferHelper {
    error SafeTransferFailed();
    error SafeTransferFromFailed();
    error SafeApproveFailed();
    error SafeTransferETHFailed();

    function safeTransferETH(address to, uint256 value) internal {
        (bool success,) = to.call{value: value}("");
        if (!success) revert SafeTransferETHFailed();
    }

    function safeTransfer(address token, address to, uint256 value) internal {
        // bytes4(keccak256("transfer(address,uint256)")) == 0xa9059cbb
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(0xa9059cbb, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeTransferFailed();
        }
    }

    function safeTransferFrom(address token, address from, address to, uint256 value) internal {
        // bytes4(keccak256("transferFrom(address,address,uint256)")) == 0x23b872dd
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(0x23b872dd, from, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeTransferFromFailed();
        }
    }

    function safeApprove(address token, address to, uint256 value) internal {
        // bytes4(keccak256("approve(address,uint256)")) == 0x095ea7b3
        (bool success, bytes memory data) =
            token.call(abi.encodeWithSelector(0x095ea7b3, to, value));
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            revert SafeApproveFailed();
        }
    }
}
