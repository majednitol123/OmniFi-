// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Library } from "../../src/v2/libraries/OmniFiV2Library.sol";

contract OmniFiV2LibraryWrapper {
    function sortTokens(address tokenA, address tokenB)
        external
        pure
        returns (address token0, address token1)
    {
        return OmniFiV2Library.sortTokens(tokenA, tokenB);
    }

    function quote(uint256 amountA, uint256 reserveA, uint256 reserveB)
        external
        pure
        returns (uint256 amountB)
    {
        return OmniFiV2Library.quote(amountA, reserveA, reserveB);
    }

    function getAmountOut(uint256 amountIn, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        external
        pure
        returns (uint256 amountOut)
    {
        return OmniFiV2Library.getAmountOut(amountIn, reserveIn, reserveOut, fee);
    }

    function getAmountIn(uint256 amountOut, uint256 reserveIn, uint256 reserveOut, uint24 fee)
        external
        pure
        returns (uint256 amountIn)
    {
        return OmniFiV2Library.getAmountIn(amountOut, reserveIn, reserveOut, fee);
    }
}

contract OmniFiV2LibraryTest is Test {
    OmniFiV2LibraryWrapper internal lib;
    address internal tokenA = address(0x1111111111111111111111111111111111111111);
    address internal tokenB = address(0x2222222222222222222222222222222222222222);

    function setUp() public {
        lib = new OmniFiV2LibraryWrapper();
    }

    function test_SortTokens_Normal() public view {
        (address token0, address token1) = lib.sortTokens(tokenA, tokenB);
        assertEq(token0, tokenA);
        assertEq(token1, tokenB);
    }

    function test_SortTokens_Reversed() public view {
        (address token0, address token1) = lib.sortTokens(tokenB, tokenA);
        assertEq(token0, tokenA);
        assertEq(token1, tokenB);
    }

    function test_SortTokens_IdenticalAddresses_Reverts() public {
        vm.expectRevert(OmniFiV2Library.IdenticalAddresses.selector);
        lib.sortTokens(tokenA, tokenA);
    }

    function test_SortTokens_ZeroAddress_Reverts() public {
        vm.expectRevert(OmniFiV2Library.ZeroAddress.selector);
        lib.sortTokens(address(0), tokenB);
    }

    function test_Quote() public view {
        uint256 amountB = lib.quote(1000, 2000, 4000);
        assertEq(amountB, 2000);
    }

    function test_Quote_ZeroAmount_Reverts() public {
        vm.expectRevert(OmniFiV2Library.InsufficientInputAmount.selector);
        lib.quote(0, 2000, 4000);
    }

    function test_Quote_ZeroReserves_Reverts() public {
        vm.expectRevert(OmniFiV2Library.InsufficientLiquidity.selector);
        lib.quote(1000, 0, 4000);

        vm.expectRevert(OmniFiV2Library.InsufficientLiquidity.selector);
        lib.quote(1000, 2000, 0);
    }

    // --- Vector Tests for getAmountOut ---

    function test_GetAmountOut_TypicalSwap_030pct() public view {
        // From vectors.json: typical_swap_0.30pct
        uint256 amountIn = 1_000_000_000;
        uint256 reserveIn = 1_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 996_006_981);
    }

    function test_GetAmountOut_SmallSwapLargePool() public view {
        // From vectors.json: small_swap_large_pool
        uint256 amountIn = 1000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 996);
    }

    function test_GetAmountOut_LargeSwapHighImpact() public view {
        // From vectors.json: large_swap_high_impact
        uint256 amountIn = 500_000_000_000_000_000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 332_665_999_332_665_999);
    }

    function test_GetAmountOut_SwapWithProtocolFee() public view {
        // From vectors.json: swap_with_protocol_fee
        uint256 amountIn = 1_000_000_000_000_000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 996_006_981_039_903);
    }

    function test_GetAmountOut_Stablecoin_001pct() public view {
        // From vectors.json: stablecoin_swap_0.01pct
        uint256 amountIn = 1_000_000_000;
        uint256 reserveIn = 1_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000;
        uint24 fee = 100;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 998_901_198);
    }

    function test_GetAmountOut_Exotic_100pct() public view {
        // From vectors.json: exotic_swap_1.00pct
        uint256 amountIn = 1_000_000_000_000_000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000;
        uint24 fee = 10_000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 989_020_869);
    }

    function test_GetAmountOut_AsymmetricReserves() public view {
        // From vectors.json: asymmetric_reserves
        uint256 amountIn = 10_000;
        uint256 reserveIn = 1_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 500;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 9_896_088_594_497_992);
    }

    function test_GetAmountOut_MinimumSwap() public view {
        // From vectors.json: minimum_swap
        uint256 amountIn = 100;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountOut = lib.getAmountOut(amountIn, reserveIn, reserveOut, fee);
        assertEq(amountOut, 98);
    }

    // --- Vector Tests for getAmountIn ---

    function test_GetAmountIn_TypicalExactOutput() public view {
        // From vectors.json: typical_exact_output
        uint256 amountOut = 1_000_000_000_000_000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountIn = lib.getAmountIn(amountOut, reserveIn, reserveOut, fee);
        assertEq(amountIn, 1_004_013_040_121_367);
    }

    function test_GetAmountIn_SmallExactOutput() public view {
        // From vectors.json: small_exact_output
        uint256 amountOut = 1000;
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint24 fee = 3000;

        uint256 amountIn = lib.getAmountIn(amountOut, reserveIn, reserveOut, fee);
        assertEq(amountIn, 1005);
    }

    function test_GetAmountIn_RoundTrip() public view {
        // If we compute amountIn = getAmountIn(amountOut), then getAmountOut(amountIn) must be >= amountOut
        uint256 reserveIn = 1_000_000_000_000_000_000;
        uint256 reserveOut = 1_000_000_000_000_000_000;
        uint256 desiredOut = 50_000_000_000_000;

        uint256 requiredIn = lib.getAmountIn(desiredOut, reserveIn, reserveOut, 3000);
        uint256 actualOut = lib.getAmountOut(requiredIn, reserveIn, reserveOut, 3000);

        assertGe(actualOut, desiredOut, "actualOut must be at least desiredOut");
    }

    function test_GetAmountOut_ZeroAmount_Reverts() public {
        vm.expectRevert(OmniFiV2Library.InsufficientInputAmount.selector);
        lib.getAmountOut(0, 1000, 1000, 3000);
    }

    function test_GetAmountIn_ZeroAmount_Reverts() public {
        vm.expectRevert(OmniFiV2Library.InsufficientOutputAmount.selector);
        lib.getAmountIn(0, 1000, 1000, 3000);
    }

    function test_GetAmountIn_ExceedsReserves_Reverts() public {
        vm.expectRevert(OmniFiV2Library.InsufficientLiquidity.selector);
        lib.getAmountIn(1000, 1000, 1000, 3000);
    }
}
