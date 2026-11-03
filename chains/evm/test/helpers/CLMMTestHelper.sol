// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiMintCallback } from "../../src/interfaces/IOmniFiMintCallback.sol";
import { IOmniFiSwapCallback } from "../../src/interfaces/IOmniFiSwapCallback.sol";
import { IERC20Minimal } from "../../src/interfaces/IERC20Minimal.sol";

contract CLMMTestHelper is IOmniFiMintCallback, IOmniFiSwapCallback {
    address public token0;
    address public token1;

    constructor(address _token0, address _token1) {
        token0 = _token0;
        token1 = _token1;
    }

    function omniFiMintCallback(
        uint256 amount0Owed,
        uint256 amount1Owed,
        bytes calldata /* data */
    )
        external
        override
    {
        if (amount0Owed > 0) {
            IERC20Minimal(token0).transfer(msg.sender, amount0Owed);
        }
        if (amount1Owed > 0) {
            IERC20Minimal(token1).transfer(msg.sender, amount1Owed);
        }
    }

    function omniFiSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* data */
    )
        external
        override
    {
        if (amount0Delta > 0) {
            IERC20Minimal(token0).transfer(msg.sender, uint256(amount0Delta));
        }
        if (amount1Delta > 0) {
            IERC20Minimal(token1).transfer(msg.sender, uint256(amount1Delta));
        }
    }
}
