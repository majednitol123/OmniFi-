// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IMulticall } from "../interfaces/IMulticall.sol";

/// @title Multicall
/// @notice Enables calling multiple methods in a single transaction on the inheriting contract
abstract contract Multicall is IMulticall {
    error MulticallFailed();

    /// @inheritdoc IMulticall
    function multicall(bytes[] calldata data) external payable override returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i = 0; i < data.length; i++) {
            (bool success, bytes memory result) = address(this).delegatecall(data[i]);

            if (!success) {
                // If subcall returned revert data, bubble it up directly via assembly
                if (result.length == 0) revert MulticallFailed();
                assembly {
                    revert(add(32, result), mload(result))
                }
            }

            results[i] = result;
        }
    }
}

