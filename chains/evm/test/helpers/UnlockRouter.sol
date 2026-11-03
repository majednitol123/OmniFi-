// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IUnlockCallback } from "../../src/interfaces/IUnlockCallback.sol";
import { IOmniFiPoolManager } from "../../src/interfaces/IOmniFiPoolManager.sol";
import { Currency, CurrencyLibrary } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { BalanceDelta } from "../../src/v4-core/types/BalanceDelta.sol";
import { MockERC20 } from "./MockERC20.sol";

/// @title UnlockRouter
/// @notice Periphery helper contract for testing unlock callbacks and flash accounting
contract UnlockRouter is IUnlockCallback {
    enum Action {
        None,
        ModifyLiquidityAndSettle,
        SwapAndSettle,
        SwapWithoutSettle,
        NestedUnlock,
        TakeWithoutCredit,
        DonateAndSettle
    }

    struct CallbackData {
        Action action;
        PoolKey key;
        IOmniFiPoolManager.ModifyLiquidityParams modifyParams;
        IOmniFiPoolManager.SwapParams swapParams;
        uint256 donateAmount0;
        uint256 donateAmount1;
        address recipient;
    }

    IOmniFiPoolManager public immutable poolManager;

    constructor(address _poolManager) {
        poolManager = IOmniFiPoolManager(_poolManager);
    }

    function execute(CallbackData memory data) external payable returns (bytes memory) {
        return poolManager.unlock(abi.encode(data));
    }

    function unlockCallback(bytes calldata rawData) external override returns (bytes memory) {
        require(msg.sender == address(poolManager), "Unauthorized callback");
        CallbackData memory data = abi.decode(rawData, (CallbackData));

        if (data.action == Action.ModifyLiquidityAndSettle) {
            BalanceDelta delta = poolManager.modifyLiquidity(data.key, data.modifyParams);
            _settleDeltas(data.key, delta, data.recipient);
            return abi.encode(delta);
        } else if (data.action == Action.SwapAndSettle) {
            BalanceDelta delta = poolManager.swap(data.key, data.swapParams);
            _settleDeltas(data.key, delta, data.recipient);
            return abi.encode(delta);
        } else if (data.action == Action.SwapWithoutSettle) {
            // Intentionally skip settlement to test reversion
            BalanceDelta delta = poolManager.swap(data.key, data.swapParams);
            return abi.encode(delta);
        } else if (data.action == Action.NestedUnlock) {
            // Attempt nested unlock to test reentrancy prevention
            poolManager.unlock("");
            return "";
        } else if (data.action == Action.TakeWithoutCredit) {
            // Attempt to take tokens without credit
            poolManager.take(data.key.currency0, data.recipient, 1 ether);
            return "";
        } else if (data.action == Action.DonateAndSettle) {
            BalanceDelta delta =
                poolManager.donate(data.key, data.donateAmount0, data.donateAmount1);
            _settleDeltas(data.key, delta, data.recipient);
            return abi.encode(delta);
        }

        return "";
    }

    function _settleDeltas(
        PoolKey memory key,
        BalanceDelta,
        /* delta */
        address recipient
    )
        internal
    {
        int256 d0 = poolManager.getDelta(address(this), key.currency0);
        int256 d1 = poolManager.getDelta(address(this), key.currency1);

        // Settle currency 0
        if (d0 > 0) {
            if (!CurrencyLibrary.isNative(key.currency0)) {
                MockERC20(Currency.unwrap(key.currency0)).approve(address(poolManager), uint256(d0));
            }
            poolManager.settle{ value: CurrencyLibrary.isNative(key.currency0) ? uint256(d0) : 0 }(
                key.currency0
            );
        } else if (d0 < 0) {
            poolManager.take(key.currency0, recipient, uint256(-d0));
        }

        // Settle currency 1
        if (d1 > 0) {
            if (!CurrencyLibrary.isNative(key.currency1)) {
                MockERC20(Currency.unwrap(key.currency1)).approve(address(poolManager), uint256(d1));
            }
            poolManager.settle{ value: CurrencyLibrary.isNative(key.currency1) ? uint256(d1) : 0 }(
                key.currency1
            );
        } else if (d1 < 0) {
            poolManager.take(key.currency1, recipient, uint256(-d1));
        }
    }

    receive() external payable { }
}
