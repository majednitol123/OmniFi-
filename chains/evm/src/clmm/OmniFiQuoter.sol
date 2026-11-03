// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiQuoter } from "../interfaces/IOmniFiQuoter.sol";
import { IOmniFiSwapCallback } from "../interfaces/IOmniFiSwapCallback.sol";
import { IOmniFiPoolFactory } from "../interfaces/IOmniFiPoolFactory.sol";
import { IOmniFiPool } from "../interfaces/IOmniFiPool.sol";
import { Path } from "./libraries/Path.sol";
import { TickMath } from "./libraries/TickMath.sol";

/// @title OmniFi CLMM Quoter
/// @notice Computes quotes for swaps against OmniFi CLMM pools using try/catch simulation
contract OmniFiQuoter is IOmniFiQuoter, IOmniFiSwapCallback {
    using Path for bytes;

    error PoolDoesNotExist();

    address public immutable factory;

    constructor(address _factory) {
        factory = _factory;
    }

    /// @inheritdoc IOmniFiSwapCallback
    function omniFiSwapCallback(
        int256 amount0Delta,
        int256 amount1Delta,
        bytes calldata /* data */
    )
        external
        pure
        override
    {
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, amount0Delta)
            mstore(add(ptr, 0x20), amount1Delta)
            revert(ptr, 0x40)
        }
    }

    function parseRevertReason(bytes memory reason)
        private
        pure
        returns (int256 amount0, int256 amount1)
    {
        if (reason.length != 64) {
            assembly {
                revert(add(reason, 0x20), mload(reason))
            }
        }
        (amount0, amount1) = abi.decode(reason, (int256, int256));
    }

    /// @inheritdoc IOmniFiQuoter
    function quoteExactInputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn,
        uint160 sqrtPriceLimitX96
    ) external override returns (uint256 amountOut) {
        address pool = IOmniFiPoolFactory(factory).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert PoolDoesNotExist();

        bool zeroForOne = tokenIn < tokenOut;

        if (sqrtPriceLimitX96 == 0) {
            sqrtPriceLimitX96 =
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }

        try IOmniFiPool(pool)
            .swap(address(this), zeroForOne, int256(amountIn), sqrtPriceLimitX96, "") { }
        catch (bytes memory reason) {
            (int256 a0, int256 a1) = parseRevertReason(reason);
            amountOut = uint256(-(zeroForOne ? a1 : a0));
        }
    }

    /// @inheritdoc IOmniFiQuoter
    function quoteExactOutputSingle(
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountOut,
        uint160 sqrtPriceLimitX96
    ) external override returns (uint256 amountIn) {
        address pool = IOmniFiPoolFactory(factory).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert PoolDoesNotExist();

        bool zeroForOne = tokenIn < tokenOut;

        if (sqrtPriceLimitX96 == 0) {
            sqrtPriceLimitX96 =
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }

        try IOmniFiPool(pool)
            .swap(address(this), zeroForOne, -int256(amountOut), sqrtPriceLimitX96, "") { }
        catch (bytes memory reason) {
            (int256 a0, int256 a1) = parseRevertReason(reason);
            amountIn = uint256(zeroForOne ? a0 : a1);
        }
    }

    /// @inheritdoc IOmniFiQuoter
    function quoteExactInput(bytes memory path, uint256 amountIn)
        external
        override
        returns (uint256 amountOut)
    {
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();
            (address tokenIn, address tokenOut, uint24 fee) = path.decodeFirstPool();

            amountIn = this.quoteExactInputSingle(tokenIn, tokenOut, fee, amountIn, 0);

            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }
    }

    /// @inheritdoc IOmniFiQuoter
    function quoteExactOutput(bytes memory path, uint256 amountOut)
        external
        override
        returns (uint256 amountIn)
    {
        // For exact output, path is tokenOut -> fee -> ... -> tokenIn
        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();
            (address tokenOut, address tokenIn, uint24 fee) = path.decodeFirstPool();

            amountOut = this.quoteExactOutputSingle(tokenIn, tokenOut, fee, amountOut, 0);

            if (hasMultiplePools) {
                path = path.skipToken();
            } else {
                amountIn = amountOut;
                break;
            }
        }
    }
}
