// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Pair } from "../../src/v2/OmniFiV2Pair.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiV2DifferentialTest is Test {
    OmniFiV2Factory internal factory;
    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal trader = address(0x101);

    function setUp() public {
        factory = new OmniFiV2Factory(owner, feeRecipient);
    }

    function _createAndFundPair(uint256 reserve0Amount, uint256 reserve1Amount)
        internal
        returns (OmniFiV2Pair pair, MockERC20 token0, MockERC20 token1)
    {
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        pair = OmniFiV2Pair(pairAddress);

        token0 = MockERC20(pair.token0());
        token1 = MockERC20(pair.token1());

        token0.mint(address(pair), reserve0Amount);
        token1.mint(address(pair), reserve1Amount);
        pair.mint(owner);
    }

    // --- Differential Test: typical_swap_0.30pct ---
    function test_Differential_TypicalSwap_030pct() public {
        (OmniFiV2Pair pair, MockERC20 token0, MockERC20 token1) =
            _createAndFundPair(1_000_000_000_000, 1_000_000_000_000);

        uint256 amountIn = 1_000_000_000;
        uint256 expectedOut = 996_006_981;

        token0.mint(trader, amountIn);
        vm.startPrank(trader);
        token0.transfer(address(pair), amountIn);
        pair.swap(0, expectedOut, trader, new bytes(0));
        vm.stopPrank();

        assertEq(token1.balanceOf(trader), expectedOut);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1_000_997_000_000 + 3_000_000); // 1000997000000 + lp_fee (retained in reserves when proto fee is 0)
        assertEq(r1, 999_003_993_019);
    }

    // --- Differential Test: small_swap_large_pool ---
    function test_Differential_SmallSwapLargePool() public {
        (OmniFiV2Pair pair, MockERC20 token0, MockERC20 token1) =
            _createAndFundPair(1_000_000_000_000_000_000, 1_000_000_000_000_000_000);

        uint256 amountIn = 1000;
        uint256 expectedOut = 996;

        token0.mint(trader, amountIn);
        vm.startPrank(trader);
        token0.transfer(address(pair), amountIn);
        pair.swap(0, expectedOut, trader, new bytes(0));
        vm.stopPrank();

        assertEq(token1.balanceOf(trader), expectedOut);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1_000_000_000_000_000_000 + amountIn);
        assertEq(r1, 1_000_000_000_000_000_000 - expectedOut);
    }

    // --- Differential Test: large_swap_high_impact ---
    function test_Differential_LargeSwapHighImpact() public {
        (OmniFiV2Pair pair, MockERC20 token0, MockERC20 token1) =
            _createAndFundPair(1_000_000_000_000_000_000, 1_000_000_000_000_000_000);

        uint256 amountIn = 500_000_000_000_000_000;
        uint256 expectedOut = 332_665_999_332_665_999;

        token0.mint(trader, amountIn);
        vm.startPrank(trader);
        token0.transfer(address(pair), amountIn);
        pair.swap(0, expectedOut, trader, new bytes(0));
        vm.stopPrank();

        assertEq(token1.balanceOf(trader), expectedOut);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1_000_000_000_000_000_000 + amountIn);
        assertEq(r1, 1_000_000_000_000_000_000 - expectedOut);
    }

    // --- Differential Test: swap_with_protocol_fee ---
    function test_Differential_SwapWithProtocolFee() public {
        vm.prank(owner);
        factory.setProtocolFeeFraction(1); // 25% protocol fee

        (OmniFiV2Pair pair, MockERC20 token0, MockERC20 token1) =
            _createAndFundPair(1_000_000_000_000_000_000, 1_000_000_000_000_000_000);

        uint256 amountIn = 1_000_000_000_000_000;
        uint256 expectedOut = 996_006_981_039_903;
        uint256 expectedProtoFee = 750_000_000_000;

        token0.mint(trader, amountIn);
        vm.startPrank(trader);
        token0.transfer(address(pair), amountIn);
        pair.swap(0, expectedOut, trader, new bytes(0));
        vm.stopPrank();

        assertEq(token1.balanceOf(trader), expectedOut);
        assertEq(pair.protocolFees(address(token0)), expectedProtoFee);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        // New reserve0 = 1e18 + amountIn - protocolFee
        assertEq(r0, 1_000_000_000_000_000_000 + amountIn - expectedProtoFee);
        assertEq(r1, 1_000_000_000_000_000_000 - expectedOut);
    }

    // --- Differential Test: add_liquidity_initial balanced ---
    function test_Differential_AddLiquidityInitial_Balanced() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        OmniFiV2Pair pair = OmniFiV2Pair(pairAddress);

        tokenA.mint(address(pair), 1 ether);
        tokenB.mint(address(pair), 1 ether);
        uint256 liquidity = pair.mint(trader);

        // From vectors.json: lp_minted_user = 1 ether - 1000, total_supply = 1 ether
        assertEq(liquidity, 1 ether - 1000);
        assertEq(pair.totalSupply(), 1 ether);
        assertEq(pair.balanceOf(address(0)), 1000);
    }

    // --- Differential Test: add_liquidity_initial asymmetric ---
    function test_Differential_AddLiquidityInitial_Asymmetric() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        OmniFiV2Pair pair = OmniFiV2Pair(pairAddress);
        MockERC20 token0 = MockERC20(pair.token0());
        MockERC20 token1 = MockERC20(pair.token1());

        token0.mint(address(pair), 1_000_000);
        token1.mint(address(pair), 1_000_000_000_000_000_000);
        uint256 liquidity = pair.mint(trader);

        // From vectors.json: lp_minted_total = 1_000_000_000_000, user = 999_999_999_000
        assertEq(pair.totalSupply(), 1_000_000_000_000);
        assertEq(liquidity, 999_999_999_000);
        assertEq(pair.balanceOf(address(0)), 1000);
    }

    // --- Differential Test: remove_liquidity large ---
    function test_Differential_RemoveLiquidity_Large() public {
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        OmniFiV2Pair pair = OmniFiV2Pair(pairAddress);

        tokenA.mint(address(pair), 1 ether);
        tokenB.mint(address(pair), 1 ether);
        uint256 userLp = pair.mint(trader);

        // Trader burns all their LP: 1 ether - 1000
        vm.startPrank(trader);
        pair.transfer(address(pair), userLp);
        (uint256 a0, uint256 a1) = pair.burn(trader);
        vm.stopPrank();

        // From vectors.json: remaining reserves = 1000, total_supply = 1000
        assertEq(a0, 1 ether - 1000);
        assertEq(a1, 1 ether - 1000);
        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1000);
        assertEq(r1, 1000);
        assertEq(pair.totalSupply(), 1000);
    }
}
