// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiV2Router } from "../interfaces/IOmniFiV2Router.sol";
import { IOmniFiV2Factory } from "../interfaces/IOmniFiV2Factory.sol";
import { IOmniFiV2Pair } from "../interfaces/IOmniFiV2Pair.sol";
import { OmniFiV2Library } from "./libraries/OmniFiV2Library.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { Multicall } from "../periphery/Multicall.sol";

/// @title OmniFi V2 Router
/// @notice Periphery contract for multi-hop swaps, slippage enforcement, and liquidity management
contract OmniFiV2Router is IOmniFiV2Router, Multicall {
    address public immutable override factory;

    modifier ensure(uint256 deadline) {
        if (block.timestamp > deadline) revert Expired();
        _;
    }

    constructor(address factory_) {
        factory = factory_;
    }

    function _addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin
    ) internal returns (uint256 amountA, uint256 amountB) {
        if (IOmniFiV2Factory(factory).getPair(tokenA, tokenB) == address(0)) {
            IOmniFiV2Factory(factory).createPair(tokenA, tokenB);
        }

        (uint112 reserveA, uint112 reserveB) = OmniFiV2Library.getReserves(factory, tokenA, tokenB);
        if (reserveA == 0 && reserveB == 0) {
            (amountA, amountB) = (amountADesired, amountBDesired);
        } else {
            uint256 amountBOptimal = OmniFiV2Library.quote(amountADesired, reserveA, reserveB);
            if (amountBOptimal <= amountBDesired) {
                if (amountBOptimal < amountBMin) revert InsufficientBAmount();
                (amountA, amountB) = (amountADesired, amountBOptimal);
            } else {
                uint256 amountAOptimal = OmniFiV2Library.quote(amountBDesired, reserveB, reserveA);
                assert(amountAOptimal <= amountADesired);
                if (amountAOptimal < amountAMin) revert InsufficientAAmount();
                (amountA, amountB) = (amountAOptimal, amountBDesired);
            }
        }
    }

    /// @notice Adds liquidity to an OmniFi V2 pair with slippage limits
    function addLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    )
        external
        override
        ensure(deadline)
        returns (uint256 amountA, uint256 amountB, uint256 liquidity)
    {
        (amountA, amountB) = _addLiquidity(
            tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin
        );
        address pair = IOmniFiV2Factory(factory).getPair(tokenA, tokenB);
        TransferHelper.safeTransferFrom(tokenA, msg.sender, pair, amountA);
        TransferHelper.safeTransferFrom(tokenB, msg.sender, pair, amountB);
        liquidity = IOmniFiV2Pair(pair).mint(to);
    }

    /// @notice Removes liquidity from an OmniFi V2 pair with minimum amount enforcement
    function removeLiquidity(
        address tokenA,
        address tokenB,
        uint256 liquidity,
        uint256 amountAMin,
        uint256 amountBMin,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256 amountA, uint256 amountB) {
        address pair = IOmniFiV2Factory(factory).getPair(tokenA, tokenB);
        TransferHelper.safeTransferFrom(pair, msg.sender, pair, liquidity);
        (uint256 amount0, uint256 amount1) = IOmniFiV2Pair(pair).burn(to);
        (address token0,) = OmniFiV2Library.sortTokens(tokenA, tokenB);
        (amountA, amountB) = tokenA == token0 ? (amount0, amount1) : (amount1, amount0);

        if (amountA < amountAMin) revert InsufficientAAmount();
        if (amountB < amountBMin) revert InsufficientBAmount();
    }

    function _swap(uint256[] memory amounts, address[] memory path, address to) internal {
        for (uint256 i = 0; i < path.length - 1; i++) {
            (address input, address output) = (path[i], path[i + 1]);
            (address token0,) = OmniFiV2Library.sortTokens(input, output);
            uint256 amountOut = amounts[i + 1];
            (uint256 amount0Out, uint256 amount1Out) =
                input == token0 ? (uint256(0), amountOut) : (amountOut, uint256(0));
            address recipient =
                i < path.length - 2 ? IOmniFiV2Factory(factory).getPair(output, path[i + 2]) : to;
            IOmniFiV2Pair(IOmniFiV2Factory(factory).getPair(input, output))
                .swap(amount0Out, amount1Out, recipient, new bytes(0));
        }
    }

    /// @notice Swaps an exact input amount of tokens for as many output tokens as possible along a multi-hop path
    function swapExactTokensForTokens(
        uint256 amountIn,
        uint256 amountOutMin,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = OmniFiV2Library.getAmountsOut(factory, amountIn, path);
        if (amounts[amounts.length - 1] < amountOutMin) revert InsufficientOutputAmount();

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IOmniFiV2Factory(factory).getPair(path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }

    /// @notice Swaps as few input tokens as possible for an exact output amount along a multi-hop path
    function swapTokensForExactTokens(
        uint256 amountOut,
        uint256 amountInMax,
        address[] calldata path,
        address to,
        uint256 deadline
    ) external override ensure(deadline) returns (uint256[] memory amounts) {
        amounts = OmniFiV2Library.getAmountsIn(factory, amountOut, path);
        if (amounts[0] > amountInMax) revert ExcessiveInputAmount();

        TransferHelper.safeTransferFrom(
            path[0], msg.sender, IOmniFiV2Factory(factory).getPair(path[0], path[1]), amounts[0]
        );
        _swap(amounts, path, to);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        external
        pure
        override
        returns (uint256 amountB)
    {
        return OmniFiV2Library.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        override
        returns (uint256 amountOut)
    {
        return OmniFiV2Library.getAmountOut(amountIn, reserveIn, reserveOut);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        external
        pure
        override
        returns (uint256 amountIn)
    {
        return OmniFiV2Library.getAmountIn(amountOut, reserveIn, reserveOut);
    }

    function getAmountsOut(uint256 amountIn, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        return OmniFiV2Library.getAmountsOut(factory, amountIn, path);
    }

    function getAmountsIn(uint256 amountOut, address[] calldata path)
        external
        view
        override
        returns (uint256[] memory amounts)
    {
        return OmniFiV2Library.getAmountsIn(factory, amountOut, path);
    }
}
