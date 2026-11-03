// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Pair } from "../../src/v2/OmniFiV2Pair.sol";
import { IOmniFiV2Pair } from "../../src/interfaces/IOmniFiV2Pair.sol";
import { IOmniFiV2Factory } from "../../src/interfaces/IOmniFiV2Factory.sol";
import { OmniFiV2Library } from "../../src/v2/libraries/OmniFiV2Library.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiV2PairTest is Test {
    OmniFiV2Factory internal factory;
    OmniFiV2Pair internal pair;
    MockERC20 internal token0;
    MockERC20 internal token1;

    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal user1 = address(0x101);
    address internal user2 = address(0x102);

    function setUp() public {
        factory = new OmniFiV2Factory(owner, feeRecipient);
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        pair = OmniFiV2Pair(pairAddress);

        token0 = MockERC20(pair.token0());
        token1 = MockERC20(pair.token1());

        // Fund user1 and user2
        token0.mint(user1, 10_000_000 ether);
        token1.mint(user1, 10_000_000 ether);
        token0.mint(user2, 10_000_000 ether);
        token1.mint(user2, 10_000_000 ether);
    }

    function test_InitialMint_Balanced() public {
        uint256 deposit0 = 1 ether;
        uint256 deposit1 = 1 ether;

        vm.startPrank(user1);
        token0.transfer(address(pair), deposit0);
        token1.transfer(address(pair), deposit1);
        uint256 liquidity = pair.mint(user1);
        vm.stopPrank();

        // 1 ether * 1 ether = 1e36. sqrt(1e36) = 1e18 = 1 ether.
        // User gets: 1 ether - 1000 (MINIMUM_LIQUIDITY)
        assertEq(liquidity, 1 ether - 1000);
        assertEq(pair.balanceOf(user1), 1 ether - 1000);
        assertEq(pair.balanceOf(address(0)), 1000);
        assertEq(pair.totalSupply(), 1 ether);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1 ether);
        assertEq(r1, 1 ether);
    }

    function test_InitialMint_InsufficientLiquidity_Reverts() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1000);
        token1.transfer(address(pair), 1000);
        // sqrt(1000 * 1000) = 1000 <= MINIMUM_LIQUIDITY (1000) -> reverts
        vm.expectRevert(IOmniFiV2Pair.InsufficientLiquidity.selector);
        pair.mint(user1);
        vm.stopPrank();
    }

    function test_SubsequentMint_Proportional() public {
        // Initial mint
        vm.startPrank(user1);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 1 ether);
        pair.mint(user1);
        vm.stopPrank();

        // Second mint: 0.5 ether of each
        vm.startPrank(user2);
        token0.transfer(address(pair), 0.5 ether);
        token1.transfer(address(pair), 0.5 ether);
        uint256 liquidity = pair.mint(user2);
        vm.stopPrank();

        assertEq(liquidity, 0.5 ether);
        assertEq(pair.balanceOf(user2), 0.5 ether);
        assertEq(pair.totalSupply(), 1.5 ether);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1.5 ether);
        assertEq(r1, 1.5 ether);
    }

    function test_SubsequentMint_Imbalanced() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 1 ether);
        pair.mint(user1);
        vm.stopPrank();

        // Depositor provides 1 ether of token0 but only 0.5 ether of token1
        vm.startPrank(user2);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 0.5 ether);
        uint256 liquidity = pair.mint(user2);
        vm.stopPrank();

        // Minted is min(1 ether * 1 ether / 1 ether, 0.5 ether * 1 ether / 1 ether) = 0.5 ether
        assertEq(liquidity, 0.5 ether);
    }

    function test_Burn_Partial() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 2 ether);
        token1.transfer(address(pair), 2 ether);
        uint256 liquidity = pair.mint(user1);

        // Burn half
        uint256 burnAmount = liquidity / 2;
        pair.transfer(address(pair), burnAmount);
        (uint256 amount0, uint256 amount1) = pair.burn(user1);
        vm.stopPrank();

        assertEq(amount0, burnAmount);
        assertEq(amount1, burnAmount);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 2 ether - burnAmount);
        assertEq(r1, 2 ether - burnAmount);
    }

    function test_Swap_Token0ForToken1() public {
        // Pool: 1000 ether of each
        vm.startPrank(user1);
        token0.transfer(address(pair), 1000 ether);
        token1.transfer(address(pair), 1000 ether);
        pair.mint(user1);
        vm.stopPrank();

        uint256 amountIn = 1 ether;
        uint256 expectedOut = OmniFiV2Library.getAmountOut(amountIn, 1000 ether, 1000 ether, 3000);

        // Trader transfers amountIn to pair and calls swap
        vm.startPrank(user2);
        token0.transfer(address(pair), amountIn);
        uint256 user2BalBefore = token1.balanceOf(user2);

        pair.swap(0, expectedOut, user2, new bytes(0));
        vm.stopPrank();

        assertEq(token1.balanceOf(user2) - user2BalBefore, expectedOut);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1000 ether + amountIn);
        assertEq(r1, 1000 ether - expectedOut);

        // Verify k invariant: k_after >= k_before
        assertGe(uint256(r0) * r1, 1000 ether * 1000 ether);
    }

    function test_Swap_Token1ForToken0() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1000 ether);
        token1.transfer(address(pair), 1000 ether);
        pair.mint(user1);
        vm.stopPrank();

        uint256 amountIn = 1 ether;
        uint256 expectedOut = OmniFiV2Library.getAmountOut(amountIn, 1000 ether, 1000 ether, 3000);

        vm.startPrank(user2);
        token1.transfer(address(pair), amountIn);
        uint256 user2BalBefore = token0.balanceOf(user2);

        pair.swap(expectedOut, 0, user2, new bytes(0));
        vm.stopPrank();

        assertEq(token0.balanceOf(user2) - user2BalBefore, expectedOut);

        (uint112 r0, uint112 r1,) = pair.getReserves();
        assertEq(r0, 1000 ether - expectedOut);
        assertEq(r1, 1000 ether + amountIn);
    }

    function test_Swap_WithProtocolFee() public {
        // Enable protocol fee (1 = 25% of LP fee)
        vm.prank(owner);
        factory.setProtocolFeeFraction(1);

        vm.startPrank(user1);
        token0.transfer(address(pair), 1000 ether);
        token1.transfer(address(pair), 1000 ether);
        pair.mint(user1);
        vm.stopPrank();

        uint256 amountIn = 1 ether;
        uint256 expectedOut = OmniFiV2Library.getAmountOut(amountIn, 1000 ether, 1000 ether, 3000);

        vm.startPrank(user2);
        token0.transfer(address(pair), amountIn);
        pair.swap(0, expectedOut, user2, new bytes(0));
        vm.stopPrank();

        // Gross fee = 1 ether * 3000 / 1_000_000 = 0.003 ether = 3e15
        // Protocol fee = 3e15 * 1 / 4 = 7.5e14 = 750_000_000_000_000
        uint256 expectedProtoFee = 750_000_000_000_000;
        assertEq(pair.protocolFees(address(token0)), expectedProtoFee);

        // Reserves exclude protocol fee!
        (uint112 r0,,) = pair.getReserves();
        assertEq(r0, 1000 ether + amountIn - expectedProtoFee);

        // Fee recipient collects protocol fees
        address recipient = address(0x999);
        vm.prank(feeRecipient);
        pair.collectProtocolFees(recipient, type(uint256).max, type(uint256).max);

        assertEq(token0.balanceOf(recipient), expectedProtoFee);
        assertEq(pair.protocolFees(address(token0)), 0);
    }

    function test_Sync_AfterDirectDonation() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 1 ether);
        pair.mint(user1);
        vm.stopPrank();

        // Direct donation without calling mint or swap
        token0.mint(address(pair), 0.5 ether);

        (uint112 r0Before,,) = pair.getReserves();
        assertEq(r0Before, 1 ether);

        pair.sync();

        (uint112 r0After,,) = pair.getReserves();
        assertEq(r0After, 1.5 ether);
    }

    function test_Skim_RecoversExcess() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 1 ether);
        pair.mint(user1);
        vm.stopPrank();

        // Direct donation
        token0.mint(address(pair), 0.5 ether);

        address recipient = address(0x888);
        pair.skim(recipient);

        assertEq(token0.balanceOf(recipient), 0.5 ether);
        (uint112 r0,,) = pair.getReserves();
        assertEq(r0, 1 ether);
    }

    function test_TWAP_Accumulation() public {
        vm.startPrank(user1);
        token0.transfer(address(pair), 1 ether);
        token1.transfer(address(pair), 2 ether); // Price = 2
        pair.mint(user1);
        vm.stopPrank();

        uint256 p0Before = pair.price0CumulativeLast();
        uint256 p1Before = pair.price1CumulativeLast();
        assertEq(p0Before, 0);
        assertEq(p1Before, 0);

        // Warp time by 100 seconds
        vm.warp(block.timestamp + 100);

        // Perform interaction to trigger update
        pair.sync();

        uint256 p0After = pair.price0CumulativeLast();
        uint256 p1After = pair.price1CumulativeLast();

        assertTrue(p0After > 0, "price0CumulativeLast should accumulate");
        assertTrue(p1After > 0, "price1CumulativeLast should accumulate");
    }
}
