// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Router } from "../../src/v2/OmniFiV2Router.sol";
import { IOmniFiV2Router } from "../../src/interfaces/IOmniFiV2Router.sol";
import { IOmniFiV2Pair } from "../../src/interfaces/IOmniFiV2Pair.sol";
import { OmniFiV2Library } from "../../src/v2/libraries/OmniFiV2Library.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiV2RouterTest is Test {
    OmniFiV2Factory internal factory;
    OmniFiV2Router internal router;
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    MockERC20 internal tokenC;

    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal user = address(0x101);

    function setUp() public {
        factory = new OmniFiV2Factory(owner, feeRecipient);
        router = new OmniFiV2Router(address(factory));

        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);
        tokenC = new MockERC20("Token C", "TKNC", 18);

        // Fund user
        tokenA.mint(user, 10_000_000 ether);
        tokenB.mint(user, 10_000_000 ether);
        tokenC.mint(user, 10_000_000 ether);

        vm.startPrank(user);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        tokenC.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    function test_AddLiquidity_Initial() public {
        vm.prank(user);
        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100 ether,
            200 ether,
            100 ether,
            200 ether,
            user,
            block.timestamp + 100
        );

        assertEq(amountA, 100 ether);
        assertEq(amountB, 200 ether);
        assertTrue(liquidity > 0);

        address pair = factory.getPair(address(tokenA), address(tokenB));
        assertTrue(pair != address(0));
        assertEq(IOmniFiV2Pair(pair).balanceOf(user), liquidity);
    }

    function test_AddLiquidity_DeadlineExpired_Reverts() public {
        vm.prank(user);
        vm.expectRevert(IOmniFiV2Router.Expired.selector);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100 ether,
            100 ether,
            100 ether,
            100 ether,
            user,
            block.timestamp - 1
        );
    }

    function test_AddLiquidity_Slippage_Reverts() public {
        // Initial liquidity: 100 ether of A, 100 ether of B (ratio 1:1)
        vm.prank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100 ether,
            100 ether,
            100 ether,
            100 ether,
            user,
            block.timestamp + 100
        );

        // Try adding with 100 A and 200 B, but min B is 150 B (since ratio is 1:1, optimal B is 100, which is < 150)
        vm.prank(user);
        vm.expectRevert(IOmniFiV2Router.InsufficientBAmount.selector);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100 ether,
            200 ether,
            100 ether,
            150 ether,
            user,
            block.timestamp + 100
        );
    }

    function test_RemoveLiquidity_Success() public {
        vm.startPrank(user);
        (,, uint256 liquidity) = router.addLiquidity(
            address(tokenA),
            address(tokenB),
            100 ether,
            100 ether,
            100 ether,
            100 ether,
            user,
            block.timestamp + 100
        );

        address pair = factory.getPair(address(tokenA), address(tokenB));
        IOmniFiV2Pair(pair).approve(address(router), liquidity);

        uint256 balABefore = tokenA.balanceOf(user);
        uint256 balBBefore = tokenB.balanceOf(user);

        (uint256 amountA, uint256 amountB) = router.removeLiquidity(
            address(tokenA),
            address(tokenB),
            liquidity,
            99 ether,
            99 ether,
            user,
            block.timestamp + 100
        );
        vm.stopPrank();

        assertGe(amountA, 99 ether);
        assertGe(amountB, 99 ether);
        assertEq(tokenA.balanceOf(user) - balABefore, amountA);
        assertEq(tokenB.balanceOf(user) - balBBefore, amountB);
    }

    function test_SwapExactTokensForTokens_SingleHop() public {
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 amountIn = 1 ether;
        uint256 expectedOut = router.getAmountsOut(amountIn, path)[1];
        uint256 balBBefore = tokenB.balanceOf(user);

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, expectedOut, path, user, block.timestamp + 100
        );
        vm.stopPrank();

        assertEq(amounts[1], expectedOut);
        assertEq(tokenB.balanceOf(user) - balBBefore, expectedOut);
    }

    function test_SwapExactTokensForTokens_MultiHop_2Hops() public {
        // Pool 1: A <-> B (1000 ether each)
        // Pool 2: B <-> C (1000 ether each)
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );
        router.addLiquidity(
            address(tokenB),
            address(tokenC),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(tokenC);

        uint256 amountIn = 5 ether;
        uint256[] memory expectedAmounts = router.getAmountsOut(amountIn, path);
        uint256 expectedOut = expectedAmounts[2];
        uint256 balCBefore = tokenC.balanceOf(user);

        uint256[] memory amounts = router.swapExactTokensForTokens(
            amountIn, expectedOut, path, user, block.timestamp + 100
        );
        vm.stopPrank();

        assertEq(amounts[2], expectedOut);
        assertEq(tokenC.balanceOf(user) - balCBefore, expectedOut);
    }

    function test_SwapExactTokensForTokens_Slippage_Reverts() public {
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 amountIn = 1 ether;
        uint256 expectedOut = router.getAmountsOut(amountIn, path)[1];

        // Demand more than expected
        vm.expectRevert(IOmniFiV2Router.InsufficientOutputAmount.selector);
        router.swapExactTokensForTokens(
            amountIn, expectedOut + 1, path, user, block.timestamp + 100
        );
        vm.stopPrank();
    }

    function test_SwapTokensForExactTokens_SingleHop() public {
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 desiredOut = 1 ether;
        uint256 expectedIn = router.getAmountsIn(desiredOut, path)[0];
        uint256 balBBefore = tokenB.balanceOf(user);

        uint256[] memory amounts = router.swapTokensForExactTokens(
            desiredOut, expectedIn, path, user, block.timestamp + 100
        );
        vm.stopPrank();

        assertEq(amounts[0], expectedIn);
        assertEq(amounts[1], desiredOut);
        assertEq(tokenB.balanceOf(user) - balBBefore, desiredOut);
    }

    function test_SwapTokensForExactTokens_MultiHop_2Hops() public {
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );
        router.addLiquidity(
            address(tokenB),
            address(tokenC),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](3);
        path[0] = address(tokenA);
        path[1] = address(tokenB);
        path[2] = address(tokenC);

        uint256 desiredOut = 2 ether;
        uint256[] memory expectedAmounts = router.getAmountsIn(desiredOut, path);
        uint256 expectedIn = expectedAmounts[0];
        uint256 balCBefore = tokenC.balanceOf(user);

        uint256[] memory amounts = router.swapTokensForExactTokens(
            desiredOut, expectedIn, path, user, block.timestamp + 100
        );
        vm.stopPrank();

        assertEq(amounts[0], expectedIn);
        assertEq(amounts[2], desiredOut);
        assertEq(tokenC.balanceOf(user) - balCBefore, desiredOut);
    }

    function test_SwapTokensForExactTokens_Slippage_Reverts() public {
        vm.startPrank(user);
        router.addLiquidity(
            address(tokenA),
            address(tokenB),
            1000 ether,
            1000 ether,
            1000 ether,
            1000 ether,
            user,
            block.timestamp + 100
        );

        address[] memory path = new address[](2);
        path[0] = address(tokenA);
        path[1] = address(tokenB);

        uint256 desiredOut = 1 ether;
        uint256 expectedIn = router.getAmountsIn(desiredOut, path)[0];

        vm.expectRevert(IOmniFiV2Router.ExcessiveInputAmount.selector);
        router.swapTokensForExactTokens(
            desiredOut,
            expectedIn - 1, // Max input less than required
            path,
            user,
            block.timestamp + 100
        );
        vm.stopPrank();
    }
}
