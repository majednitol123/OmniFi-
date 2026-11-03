// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Callback for IOmniFiPoolActions#swap
/// @notice Any contract that calls IOmniFiPoolActions#swap must implement this interface
interface IOmniFiSwapCallback {
    /// @notice Called to `msg.sender` after executing a swap via IOmniFiPool#swap.
    /// @dev In the implementation you must pay the pool tokens owed for the swap.
    /// The caller of this method must be checked to be a OmniFiPool deployed by the canonical OmniFiPoolFactory.
    /// amount0Delta and amount1Delta can both be 0, or one positive and one negative.
    /// The positive value is the amount owed to the pool, and the negative value is the amount paid to recipient.
    /// @param amount0Delta The amount of token0 that was sent (negative) or must be received (positive) by the pool
    /// @param amount1Delta The amount of token1 that was sent (negative) or must be received (positive) by the pool
    /// @param data Any data passed through by the caller via the IOmniFiPoolActions#swap call
    function omniFiSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data)
        external;
}
