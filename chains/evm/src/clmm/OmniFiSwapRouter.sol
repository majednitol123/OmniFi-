// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiSwapRouter } from "../interfaces/IOmniFiSwapRouter.sol";
import { IOmniFiSwapCallback } from "../interfaces/IOmniFiSwapCallback.sol";
import { IOmniFiPoolFactory } from "../interfaces/IOmniFiPoolFactory.sol";
import { IOmniFiPool } from "../interfaces/IOmniFiPool.sol";
import { Path } from "./libraries/Path.sol";
import { TickMath } from "./libraries/TickMath.sol";
import { TransferHelper } from "../v2/libraries/TransferHelper.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { Multicall } from "../periphery/Multicall.sol";

/// @title OmniFi CLMM Swap Router
/// @notice Executes single-hop and multi-hop token swaps across OmniFi CLMM pools
contract OmniFiSwapRouter is IOmniFiSwapRouter, IOmniFiSwapCallback, Multicall {
    using Path for bytes;

    error TransactionTooOld();
    error SlippageExceeded();
    error PoolDoesNotExist();
    error InvalidCallbackCaller();
    error NativeEtherNotAccepted();
    error InvalidSwapDeltas();
    error OnlyFactoryOwner();

    address public immutable factory;
    uint256 private amountInCached;

    struct SwapCallbackData {
        bytes path;
        address payer;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionTooOld();
        _;
    }

    constructor(address _factory) {
        factory = _factory;
    }

    /// @inheritdoc IOmniFiSwapCallback
    function omniFiSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata data)
        external
        override
    {
        if (amount0Delta <= 0 && amount1Delta <= 0) revert InvalidSwapDeltas();
        SwapCallbackData memory decoded = abi.decode(data, (SwapCallbackData));
        (address tokenIn, address tokenOut, uint24 fee) = decoded.path.decodeFirstPool();

        address pool = IOmniFiPoolFactory(factory).getPool(tokenIn, tokenOut, fee);
        if (msg.sender != pool) revert InvalidCallbackCaller();

        (bool isExactInput, uint256 amountToPay) = amount0Delta > 0
            ? (tokenIn < tokenOut, uint256(amount0Delta))
            : (tokenOut < tokenIn, uint256(amount1Delta));

        if (isExactInput) {
            if (decoded.payer == address(this)) {
                TransferHelper.safeTransfer(tokenIn, msg.sender, amountToPay);
            } else {
                TransferHelper.safeTransferFrom(tokenIn, decoded.payer, msg.sender, amountToPay);
            }
        } else {
            if (decoded.path.hasMultiplePools()) {
                decoded.path = decoded.path.skipToken();
                _exactOutputInternal(amountToPay, msg.sender, 0, decoded);
            } else {
                amountInCached = amountToPay;
                TransferHelper.safeTransferFrom(tokenOut, decoded.payer, msg.sender, amountToPay);
            }
        }
    }

    /// @inheritdoc IOmniFiSwapRouter
    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        if (msg.value > 0) revert NativeEtherNotAccepted();
        amountOut = _exactInputInternal(
            params.amountIn,
            params.recipient,
            params.sqrtPriceLimitX96,
            SwapCallbackData({
                path: abi.encodePacked(params.tokenIn, params.fee, params.tokenOut),
                payer: msg.sender
            })
        );
        if (amountOut < params.amountOutMinimum) revert SlippageExceeded();
    }

    /// @inheritdoc IOmniFiSwapRouter
    function exactInput(ExactInputParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (uint256 amountOut)
    {
        if (msg.value > 0) revert NativeEtherNotAccepted();
        address payer = msg.sender;
        bytes memory path = params.path;
        uint256 amountIn = params.amountIn;

        while (true) {
            bool hasMultiplePools = path.hasMultiplePools();

            amountIn = _exactInputInternal(
                amountIn,
                hasMultiplePools ? address(this) : params.recipient,
                0,
                SwapCallbackData({ path: path, payer: payer })
            );

            if (hasMultiplePools) {
                payer = address(this);
                path = path.skipToken();
            } else {
                amountOut = amountIn;
                break;
            }
        }

        if (amountOut < params.amountOutMinimum) revert SlippageExceeded();
    }

    function _exactInputInternal(
        uint256 amountIn,
        address recipient,
        uint160 sqrtPriceLimitX96,
        SwapCallbackData memory data
    ) private returns (uint256 amountOut) {
        (address tokenIn, address tokenOut, uint24 fee) = data.path.decodeFirstPool();
        address pool = IOmniFiPoolFactory(factory).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert PoolDoesNotExist();

        bool zeroForOne = tokenIn < tokenOut;

        if (sqrtPriceLimitX96 == 0) {
            sqrtPriceLimitX96 =
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }

        (int256 amount0, int256 amount1) = IOmniFiPool(pool)
            .swap(recipient, zeroForOne, int256(amountIn), sqrtPriceLimitX96, abi.encode(data));

        amountOut = uint256(-(zeroForOne ? amount1 : amount0));
    }

    /// @inheritdoc IOmniFiSwapRouter
    function exactOutputSingle(ExactOutputSingleParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        if (msg.value > 0) revert NativeEtherNotAccepted();
        _exactOutputInternal(
            params.amountOut,
            params.recipient,
            params.sqrtPriceLimitX96,
            SwapCallbackData({
                path: abi.encodePacked(params.tokenOut, params.fee, params.tokenIn),
                payer: msg.sender
            })
        );
        amountIn = amountInCached;
        if (amountIn > params.amountInMaximum) revert SlippageExceeded();
        amountInCached = 0;
    }

    /// @inheritdoc IOmniFiSwapRouter
    function exactOutput(ExactOutputParams calldata params)
        external
        payable
        override
        checkDeadline(params.deadline)
        returns (uint256 amountIn)
    {
        if (msg.value > 0) revert NativeEtherNotAccepted();
        // For exact output, path is tokenOut -> fee -> ... -> tokenIn
        _exactOutputInternal(
            params.amountOut,
            params.recipient,
            0,
            SwapCallbackData({ path: params.path, payer: msg.sender })
        );
        amountIn = amountInCached;
        if (amountIn > params.amountInMaximum) revert SlippageExceeded();
        amountInCached = 0;
    }

    function _exactOutputInternal(
        uint256 amountOut,
        address recipient,
        uint160 sqrtPriceLimitX96,
        SwapCallbackData memory data
    ) private returns (uint256 amountIn) {
        // First pool in path for exact output has tokenOut as first token and tokenIn as second token
        (address tokenOut, address tokenIn, uint24 fee) = data.path.decodeFirstPool();
        address pool = IOmniFiPoolFactory(factory).getPool(tokenIn, tokenOut, fee);
        if (pool == address(0)) revert PoolDoesNotExist();

        bool zeroForOne = tokenIn < tokenOut;

        if (sqrtPriceLimitX96 == 0) {
            sqrtPriceLimitX96 =
                zeroForOne ? TickMath.MIN_SQRT_PRICE + 1 : TickMath.MAX_SQRT_PRICE - 1;
        }

        (int256 amount0, int256 amount1) = IOmniFiPool(pool)
            .swap(recipient, zeroForOne, -int256(amountOut), sqrtPriceLimitX96, abi.encode(data));

        amountIn = uint256(zeroForOne ? amount0 : amount1);
    }

    /// @notice Sweeps accidentally stuck tokens to a recipient
    function sweepToken(address token, uint256 amountMinimum, address recipient) external {
        if (msg.sender != IOmniFiPoolFactory(factory).owner()) revert OnlyFactoryOwner();
        uint256 balance = IERC20Minimal(token).balanceOf(address(this));
        if (balance < amountMinimum) revert SlippageExceeded();
        TransferHelper.safeTransfer(token, recipient, balance);
    }

    /// @notice Sweeps accidentally stuck native ETH to a recipient
    function refundETH(address recipient) external {
        if (msg.sender != IOmniFiPoolFactory(factory).owner()) revert OnlyFactoryOwner();
        uint256 balance = address(this).balance;
        if (balance > 0) {
            TransferHelper.safeTransferETH(recipient, balance);
        }
    }
}
