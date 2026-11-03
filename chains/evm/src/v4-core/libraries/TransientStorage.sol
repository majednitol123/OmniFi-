// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "../types/Currency.sol";

/// @title TransientStorage
/// @notice Helper library for managing transient storage (EIP-1153) on Cancun EVM
library TransientStorage {
    bytes32 internal constant LOCK_SLOT = keccak256("omnifi.poolmanager.lock");
    bytes32 internal constant ACTIVE_LOCKER_SLOT = keccak256("omnifi.poolmanager.active_locker");

    function tstore(bytes32 slot, uint256 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    function tload(bytes32 slot) internal view returns (uint256 value) {
        assembly {
            value := tload(slot)
        }
    }

    function tstoreInt(bytes32 slot, int256 value) internal {
        assembly {
            tstore(slot, value)
        }
    }

    function tloadInt(bytes32 slot) internal view returns (int256 value) {
        assembly {
            value := tload(slot)
        }
    }

    function deltaSlot(address locker, Currency currency) internal pure returns (bytes32) {
        return keccak256(abi.encode(locker, currency, "omnifi.poolmanager.delta"));
    }

    function currencyCountSlot(address locker) internal pure returns (bytes32) {
        return keccak256(abi.encode(locker, "omnifi.poolmanager.currency.count"));
    }

    function currencyItemSlot(address locker, uint256 index) internal pure returns (bytes32) {
        return keccak256(abi.encode(locker, index, "omnifi.poolmanager.currency.item"));
    }

    function getDelta(address locker, Currency currency) internal view returns (int256) {
        return tloadInt(deltaSlot(locker, currency));
    }

    function applyDelta(address locker, Currency currency, int256 delta)
        internal
        returns (int256 newDelta)
    {
        bytes32 slot = deltaSlot(locker, currency);
        int256 currentDelta = tloadInt(slot);

        // If this is the first time this currency is touched by this locker, add to tracked list
        if (currentDelta == 0 && delta != 0) {
            bytes32 countSlot = currencyCountSlot(locker);
            uint256 count = tload(countSlot);
            tstore(currencyItemSlot(locker, count), uint256(uint160(Currency.unwrap(currency))));
            tstore(countSlot, count + 1);
        }

        newDelta = currentDelta + delta;
        tstoreInt(slot, newDelta);
    }
}
