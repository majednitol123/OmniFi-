// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FixedPoint96 } from "./FixedPoint96.sol";
import { FullMath } from "./FullMath.sol";

/// @title SqrtPriceMath
/// @notice Functions for computing token amounts and prices from sqrt price ratios and liquidity
library SqrtPriceMath {
    error InvalidPrice();
    error InvalidLiquidity();
    error PriceOverflow();
    error PriceUnderflow();

    /// @notice Helper for ceiling division
    function divRoundingUp(uint256 x, uint256 y) internal pure returns (uint256 z) {
        assembly {
            z := add(div(x, y), gt(mod(x, y), 0))
        }
    }

    /// @notice Gets the next sqrt price given an input amount of token0 or token1
    function getNextSqrtPriceFromInput(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amountIn,
        bool zeroForOne
    ) internal pure returns (uint160 sqrtPriceNextX96) {
        if (sqrtPriceX96 == 0) revert InvalidPrice();
        if (liquidity == 0) revert InvalidLiquidity();

        return zeroForOne
            ? getNextSqrtPriceFromAmount0RoundingUp(sqrtPriceX96, liquidity, amountIn, true)
            : getNextSqrtPriceFromAmount1RoundingDown(sqrtPriceX96, liquidity, amountIn, true);
    }

    /// @notice Gets the next sqrt price given an output amount of token0 or token1
    function getNextSqrtPriceFromOutput(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amountOut,
        bool zeroForOne
    ) internal pure returns (uint160 sqrtPriceNextX96) {
        if (sqrtPriceX96 == 0) revert InvalidPrice();
        if (liquidity == 0) revert InvalidLiquidity();

        return zeroForOne
            ? getNextSqrtPriceFromAmount1RoundingDown(sqrtPriceX96, liquidity, amountOut, false)
            : getNextSqrtPriceFromAmount0RoundingUp(sqrtPriceX96, liquidity, amountOut, false);
    }

    /// @notice Gets the next sqrt price given a delta of token0
    function getNextSqrtPriceFromAmount0RoundingUp(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (uint160) {
        if (amount == 0) return sqrtPriceX96;
        uint256 numerator1 = uint256(liquidity) << FixedPoint96.RESOLUTION;

        if (add) {
            uint256 product;
            if ((product = amount * sqrtPriceX96) / amount == sqrtPriceX96) {
                uint256 denominator = numerator1 + product;
                if (denominator >= numerator1) {
                    return uint160(FullMath.mulDivUp(numerator1, sqrtPriceX96, denominator));
                }
            }

            return uint160(divRoundingUp(numerator1, (numerator1 / sqrtPriceX96) + amount));
        } else {
            uint256 product;
            if ((product = amount * sqrtPriceX96) / amount != sqrtPriceX96 || numerator1 <= product)
            {
                revert PriceUnderflow();
            }
            uint256 denominator = numerator1 - product;
            return uint160(FullMath.mulDivUp(numerator1, sqrtPriceX96, denominator));
        }
    }

    /// @notice Gets the next sqrt price given a delta of token1
    function getNextSqrtPriceFromAmount1RoundingDown(
        uint160 sqrtPriceX96,
        uint128 liquidity,
        uint256 amount,
        bool add
    ) internal pure returns (uint160) {
        if (add) {
            uint256 quotient =
                (amount <= type(uint160).max
                    ? (amount << FixedPoint96.RESOLUTION) / liquidity
                    : FullMath.mulDiv(amount, FixedPoint96.Q96, liquidity));

            return uint160(uint256(sqrtPriceX96) + quotient);
        } else {
            uint256 quotient =
                (amount <= type(uint160).max
                    ? divRoundingUp(amount << FixedPoint96.RESOLUTION, liquidity)
                    : FullMath.mulDivUp(amount, FixedPoint96.Q96, liquidity));

            if (sqrtPriceX96 <= quotient) revert PriceUnderflow();
            return uint160(sqrtPriceX96 - quotient);
        }
    }

    /// @notice Gets the amount0 delta between two prices
    function getAmount0Delta(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount0) {
        if (sqrtPriceAX96 > sqrtPriceBX96) {
            (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        }

        uint256 numerator1 = uint256(liquidity) << FixedPoint96.RESOLUTION;
        uint256 numerator2 = sqrtPriceBX96 - sqrtPriceAX96;

        if (sqrtPriceAX96 == 0) revert InvalidPrice();

        return roundUp
            ? divRoundingUp(FullMath.mulDivUp(numerator1, numerator2, sqrtPriceBX96), sqrtPriceAX96)
            : FullMath.mulDiv(numerator1, numerator2, sqrtPriceBX96) / sqrtPriceAX96;
    }

    /// @notice Gets the amount1 delta between two prices
    function getAmount1Delta(
        uint160 sqrtPriceAX96,
        uint160 sqrtPriceBX96,
        uint128 liquidity,
        bool roundUp
    ) internal pure returns (uint256 amount1) {
        if (sqrtPriceAX96 > sqrtPriceBX96) {
            (sqrtPriceAX96, sqrtPriceBX96) = (sqrtPriceBX96, sqrtPriceAX96);
        }

        return roundUp
            ? FullMath.mulDivUp(liquidity, sqrtPriceBX96 - sqrtPriceAX96, FixedPoint96.Q96)
            : FullMath.mulDiv(liquidity, sqrtPriceBX96 - sqrtPriceAX96, FixedPoint96.Q96);
    }

    /// @notice Helper for signed amount0 delta
    function getAmount0Delta(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, int128 liquidity)
        internal
        pure
        returns (int256 amount0)
    {
        return liquidity < 0
            ? -int256(getAmount0Delta(sqrtPriceAX96, sqrtPriceBX96, uint128(-liquidity), false))
            : int256(getAmount0Delta(sqrtPriceAX96, sqrtPriceBX96, uint128(liquidity), true));
    }

    /// @notice Helper for signed amount1 delta
    function getAmount1Delta(uint160 sqrtPriceAX96, uint160 sqrtPriceBX96, int128 liquidity)
        internal
        pure
        returns (int256 amount1)
    {
        return liquidity < 0
            ? -int256(getAmount1Delta(sqrtPriceAX96, sqrtPriceBX96, uint128(-liquidity), false))
            : int256(getAmount1Delta(sqrtPriceAX96, sqrtPriceBX96, uint128(liquidity), true));
    }
}
