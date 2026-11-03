// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiV2Pair } from "../../interfaces/IOmniFiV2Pair.sol";
import { IOmniFiV2Factory } from "../../interfaces/IOmniFiV2Factory.sol";

/// @title OmniFi V2 Library
/// @notice Pure mathematics and helper functions for OmniFi V2 pairs and router
library OmniFiV2Library {
    uint24 public constant FEE_DENOMINATOR = 1_000_000;
    uint24 public constant STANDARD_FEE = 3000; // 0.30%

    error IdenticalAddresses();
    error ZeroAddress();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InsufficientLiquidity();
    error InvalidPath();
    error PairDoesNotExist();

    /// @notice Returns sorted token addresses, used to handle pairs in canonical order
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return token0 Lexicographically lower token address
    /// @return token1 Lexicographically higher token address
    function sortTokens(address tokenA, address tokenB)
        internal
        pure
        returns (address token0, address token1)
    {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
    }

    /// @notice Calculates the CREATE2 address for a pair without making any external calls
    /// @param factory Factory address
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @param initCodeHash Keccak256 hash of pair contract bytecode
    /// @return pair Calculated pair address
    function pairFor(address factory, address tokenA, address tokenB, bytes32 initCodeHash)
        internal
        pure
        returns (address pair)
    {
        (address token0, address token1) = sortTokens(tokenA, tokenB);
        pair = address(
            uint160(
                uint256(
                    keccak256(
                        abi.encodePacked(
                            hex"ff",
                            factory,
                            keccak256(abi.encodePacked(token0, token1)),
                            initCodeHash
                        )
                    )
                )
            )
        );
    }

    /// @notice Fetches and sorts the reserves for a pair
    /// @param factory Factory address
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return reserveA Reserve of tokenA
    /// @return reserveB Reserve of tokenB
    function getReserves(address factory, address tokenA, address tokenB)
        internal
        view
        returns (uint112 reserveA, uint112 reserveB)
    {
        (address token0,) = sortTokens(tokenA, tokenB);
        address pair = IOmniFiV2Factory(factory).getPair(tokenA, tokenB);
        if (pair == address(0)) revert PairDoesNotExist();
        (uint112 reserve0, uint112 reserve1,) = IOmniFiV2Pair(pair).getReserves();
        (reserveA, reserveB) = tokenA == token0 ? (reserve0, reserve1) : (reserve1, reserve0);
    }

    /// @notice Given some amount of an asset and pair reserves, returns an equivalent amount of the other asset
    /// @param amountA Amount of tokenA
    /// @param reserveA Reserve of tokenA
    /// @param reserveB Reserve of tokenB
    /// @return amountB Proportional amount of tokenB
    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        internal
        pure
        returns (uint256 amountB)
    {
        if (amountA == 0) revert InsufficientInputAmount();
        if (reserveA == 0 || reserveB == 0) revert InsufficientLiquidity();
        amountB = (amountA * reserveB) / reserveA;
    }

    /// @notice Given an input amount of an asset and pair reserves, returns the maximum output amount of the other asset
    /// @dev Uses fee-on-input integer math with explicit ceiling division on fee and truncation on output
    /// @param amountIn Gross input amount
    /// @param reserveIn Input token reserve
    /// @param reserveOut Output token reserve
    /// @param fee Fee in parts per million (e.g. 3000 = 0.30%)
    /// @return amountOut Net output amount
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        internal
        pure
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert InsufficientInputAmount();
        if (reserveIn == 0 || reserveOut == 0) revert InsufficientLiquidity();

        // Ceiling division: round UP on fee
        uint256 feeAmount = (amountIn * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
        uint256 amountInAfterFee = amountIn - feeAmount;
        if (amountInAfterFee == 0) revert InsufficientInputAmount();

        uint256 numerator = reserveOut * amountInAfterFee;
        uint256 denominator = reserveIn + amountInAfterFee;

        // Truncating division: round DOWN on amountOut
        amountOut = numerator / denominator;
        if (amountOut == 0) revert InsufficientOutputAmount();
    }

    /// @notice Overload of getAmountOut using standard fee (3000 = 0.30%)
    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountOut)
    {
        return getAmountOut(amountIn, reserveIn, reserveOut, STANDARD_FEE);
    }

    /// @notice Given an output amount of an asset and pair reserves, returns a required input amount of the other asset
    /// @dev Round UP on net input and gross input to guarantee invariant satisfaction
    /// @param amountOut Desired output amount
    /// @param reserveIn Input token reserve
    /// @param reserveOut Output token reserve
    /// @param fee Fee in parts per million (e.g. 3000 = 0.30%)
    /// @return amountIn Required gross input amount
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        internal
        pure
        returns (uint256 amountIn)
    {
        if (amountOut == 0) revert InsufficientOutputAmount();
        if (reserveIn == 0 || reserveOut == 0 || amountOut >= reserveOut) {
            revert InsufficientLiquidity();
        }

        // Net input required (round UP)
        uint256 numeratorNet = reserveIn * amountOut;
        uint256 denominatorNet = reserveOut - amountOut;
        uint256 amountInNet = (numeratorNet / denominatorNet) + 1;

        // Gross input required with fee (round UP)
        uint256 feeComplement = FEE_DENOMINATOR - fee;
        uint256 numeratorGross = amountInNet * FEE_DENOMINATOR;
        amountIn = (numeratorGross + feeComplement - 1) / feeComplement;
    }

    /// @notice Overload of getAmountIn using standard fee (3000 = 0.30%)
    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut)
        internal
        pure
        returns (uint256 amountIn)
    {
        return getAmountIn(amountOut, reserveIn, reserveOut, STANDARD_FEE);
    }

    /// @notice Performs chained getAmountOut calculations on any number of pairs
    /// @param factory Factory address
    /// @param amountIn Initial input amount
    /// @param path Array of token addresses representing trade route
    /// @return amounts Array of intermediate and final token amounts
    function getAmountsOut(address factory, uint256 amountIn, address[] memory path)
        internal
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[0] = amountIn;
        for (uint256 i = 0; i < path.length - 1; i++) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(factory, path[i], path[i + 1]);
            amounts[i + 1] = getAmountOut(amounts[i], reserveIn, reserveOut);
        }
    }

    /// @notice Performs chained getAmountIn calculations on any number of pairs
    /// @param factory Factory address
    /// @param amountOut Final desired output amount
    /// @param path Array of token addresses representing trade route
    /// @return amounts Array of intermediate and initial token amounts
    function getAmountsIn(address factory, uint256 amountOut, address[] memory path)
        internal
        view
        returns (uint256[] memory amounts)
    {
        if (path.length < 2) revert InvalidPath();
        amounts = new uint256[](path.length);
        amounts[amounts.length - 1] = amountOut;
        for (uint256 i = path.length - 1; i > 0; i--) {
            (uint256 reserveIn, uint256 reserveOut) = getReserves(factory, path[i - 1], path[i]);
            amounts[i - 1] = getAmountIn(amounts[i], reserveIn, reserveOut);
        }
    }
}
