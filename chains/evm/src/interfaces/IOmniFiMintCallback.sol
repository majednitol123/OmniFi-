// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Callback for IOmniFiPoolActions#mint
/// @notice Any contract that calls IOmniFiPoolActions#mint must implement this interface
interface IOmniFiMintCallback {
    /// @notice Called to `msg.sender` after minting liquidity to a position from IOmniFiPool#mint.
    /// @dev In the implementation you must pay the pool tokens owed for the minted liquidity.
    /// The caller of this method must be checked to be a OmniFiPool deployed by the canonical OmniFiPoolFactory.
    /// @param amount0Owed The amount of token0 due to the pool for the minted liquidity
    /// @param amount1Owed The amount of token1 due to the pool for the minted liquidity
    /// @param data Any data passed through by the caller via the IOmniFiPoolActions#mint call
    function omniFiMintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data)
        external;
}
