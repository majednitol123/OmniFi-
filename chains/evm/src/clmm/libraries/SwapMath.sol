// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { FullMath } from "./FullMath.sol";
import { SqrtPriceMath } from "./SqrtPriceMath.sol";

/// @title SwapMath
/// @notice Computes the result of a swap within a single tick range
library SwapMath {
    uint24 internal constant FEE_DENOMINATOR = 1_000_000;

    /// @notice Computes the result of swapping some amount in, or amount out, given the current price and target price
    /// @dev The fee, denomination 1e6, is taken off the amount in with round up
    /// @param sqrtPriceCurrentX96 The current sqrt price of the pool
    /// @param sqrtPriceTargetX96 The price that cannot be exceeded, from which the direction of the swap is inferred
    /// @param liquidity The usable liquidity
    /// @param amountRemaining How much input or output amount is remaining to be swapped in/out
    /// @param feePips The fee taken from the input amount, expressed in 1e-6 (parts per million)
    /// @return sqrtPriceNextX96 The price after swapping the amount in/out, not to exceed the price target
    /// @return amountIn The amount to be swapped in, of either token0 or token1, based on the direction of the swap
    /// @return amountOut The amount to be received, of either token0 or token1, based on the direction of the swap
    /// @return feeAmount The amount of input that will be taken as a fee
    function computeSwapStep(
        uint160 sqrtPriceCurrentX96,
        uint160 sqrtPriceTargetX96,
        uint128 liquidity,
        int256 amountRemaining,
        uint24 feePips
    )
        internal
        pure
        returns (uint160 sqrtPriceNextX96, uint256 amountIn, uint256 amountOut, uint256 feeAmount)
    {
        bool zeroForOne = sqrtPriceCurrentX96 >= sqrtPriceTargetX96;
        bool exactIn = amountRemaining >= 0;

        if (exactIn) {
            uint256 amountRemainingLessFee = FullMath.mulDiv(
                uint256(amountRemaining), FEE_DENOMINATOR - feePips, FEE_DENOMINATOR
            );
            amountIn = zeroForOne
                ? SqrtPriceMath.getAmount0Delta(
                    sqrtPriceTargetX96, sqrtPriceCurrentX96, liquidity, true
                )
                : SqrtPriceMath.getAmount1Delta(
                    sqrtPriceCurrentX96, sqrtPriceTargetX96, liquidity, true
                );
            if (amountRemainingLessFee >= amountIn) {
                sqrtPriceNextX96 = sqrtPriceTargetX96;
            } else {
                sqrtPriceNextX96 = SqrtPriceMath.getNextSqrtPriceFromInput(
                    sqrtPriceCurrentX96, liquidity, amountRemainingLessFee, zeroForOne
                );
            }
        } else {
            amountOut = zeroForOne
                ? SqrtPriceMath.getAmount1Delta(
                    sqrtPriceTargetX96, sqrtPriceCurrentX96, liquidity, false
                )
                : SqrtPriceMath.getAmount0Delta(
                    sqrtPriceCurrentX96, sqrtPriceTargetX96, liquidity, false
                );
            if (uint256(-amountRemaining) >= amountOut) {
                sqrtPriceNextX96 = sqrtPriceTargetX96;
            } else {
                sqrtPriceNextX96 = SqrtPriceMath.getNextSqrtPriceFromOutput(
                    sqrtPriceCurrentX96, liquidity, uint256(-amountRemaining), zeroForOne
                );
            }
        }

        bool max = sqrtPriceTargetX96 == sqrtPriceNextX96;

        if (zeroForOne) {
            amountIn = max && exactIn
                ? amountIn
                : SqrtPriceMath.getAmount0Delta(
                    sqrtPriceNextX96, sqrtPriceCurrentX96, liquidity, true
                );
            amountOut = max && !exactIn
                ? amountOut
                : SqrtPriceMath.getAmount1Delta(
                    sqrtPriceNextX96, sqrtPriceCurrentX96, liquidity, false
                );
        } else {
            amountIn = max && exactIn
                ? amountIn
                : SqrtPriceMath.getAmount1Delta(
                    sqrtPriceCurrentX96, sqrtPriceNextX96, liquidity, true
                );
            amountOut = max && !exactIn
                ? amountOut
                : SqrtPriceMath.getAmount0Delta(
                    sqrtPriceCurrentX96, sqrtPriceNextX96, liquidity, false
                );
        }

        // Cap the output amount to not exceed the remaining output amount
        if (!exactIn && amountOut > uint256(-amountRemaining)) {
            amountOut = uint256(-amountRemaining);
        }

        if (exactIn && sqrtPriceNextX96 != sqrtPriceTargetX96) {
            // We didn't reach the target, so take the remainder of the maximum input as fee
            feeAmount = uint256(amountRemaining) - amountIn;
        } else {
            feeAmount = FullMath.mulDivUp(amountIn, feePips, FEE_DENOMINATOR - feePips);
        }
    }
}
