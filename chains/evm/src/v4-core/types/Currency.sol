// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Currency
/// @notice User-defined value type wrapping an address for gas efficiency and type safety
type Currency is address;

using { equals as ==, notEquals as !=, greaterThan as >, lessThan as < } for Currency global;

function equals(Currency a, Currency b) pure returns (bool) {
    return Currency.unwrap(a) == Currency.unwrap(b);
}

function notEquals(Currency a, Currency b) pure returns (bool) {
    return Currency.unwrap(a) != Currency.unwrap(b);
}

function greaterThan(Currency a, Currency b) pure returns (bool) {
    return Currency.unwrap(a) > Currency.unwrap(b);
}

function lessThan(Currency a, Currency b) pure returns (bool) {
    return Currency.unwrap(a) < Currency.unwrap(b);
}

library CurrencyLibrary {
    Currency public constant NATIVE = Currency.wrap(address(0));

    function isNative(Currency currency) internal pure returns (bool) {
        return Currency.unwrap(currency) == address(0);
    }

    function toAddress(Currency currency) internal pure returns (address) {
        return Currency.unwrap(currency);
    }
}
