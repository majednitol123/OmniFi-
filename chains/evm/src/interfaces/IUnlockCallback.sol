// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title IUnlockCallback
/// @notice Interface for the callback executed by OmniFiPoolManager during unlock
interface IUnlockCallback {
    /// @notice Called by the PoolManager during unlock
    /// @param data Arbitrary data passed through from the unlock call
    /// @return result Any data the caller wants to return from unlock
    function unlockCallback(bytes calldata data) external returns (bytes memory result);
}

