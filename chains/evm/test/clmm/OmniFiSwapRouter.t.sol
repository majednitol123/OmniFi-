// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPositionManager } from "../../src/clmm/OmniFiPositionManager.sol";
import { OmniFiSwapRouter } from "../../src/clmm/OmniFiSwapRouter.sol";
import { IOmniFiSwapRouter } from "../../src/interfaces/IOmniFiSwapRouter.sol";
import { IOmniFiPositionManager } from "../../src/interfaces/IOmniFiPositionManager.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiSwapRouterTest is Test {
    OmniFiPoolFactory public factory;
    OmniFiPositionManager public posManager;
    OmniFiSwapRouter public router;

    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public alice = address(0x1111);
    address public bob = address(0x2222);

    function setUp() public {
        factory = new OmniFiPoolFactory(address(this), address(this));
        posManager = new OmniFiPositionManager(address(factory));
        router = new OmniFiSwapRouter(address(factory));

        // Deploy 3 tokens and sort them so tokenA < tokenB < tokenC
        MockERC20 t1 = new MockERC20("Token 1", "TK1", 18);
        MockERC20 t2 = new MockERC20("Token 2", "TK2", 18);
        MockERC20 t3 = new MockERC20("Token 3", "TK3", 18);

        address[3] memory tokens = [address(t1), address(t2), address(t3)];
        for (uint256 i = 0; i < 2; i++) {
            for (uint256 j = 0; j < 2 - i; j++) {
                if (tokens[j] > tokens[j + 1]) {
                    address temp = tokens[j];
                    tokens[j] = tokens[j + 1];
                    tokens[j + 1] = temp;
                }
            }
        }

        tokenA = MockERC20(tokens[0]);
        tokenB = MockERC20(tokens[1]);
        tokenC = MockERC20(tokens[2]);

        // Mint tokens to this test contract and alice
        tokenA.mint(address(this), 10_000 ether);
        tokenB.mint(address(this), 10_000 ether);
        tokenC.mint(address(this), 10_000 ether);

        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenC.mint(alice, 1000 ether);

        // Approve posManager and router
        tokenA.approve(address(posManager), type(uint256).max);
        tokenB.approve(address(posManager), type(uint256).max);
        tokenC.approve(address(posManager), type(uint256).max);

        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        tokenC.approve(address(router), type(uint256).max);

        vm.startPrank(alice);
        tokenA.approve(address(router), type(uint256).max);
        tokenB.approve(address(router), type(uint256).max);
        tokenC.approve(address(router), type(uint256).max);
        vm.stopPrank();

        // Create Pool A-B (fee = 3000, tickSpacing = 60)
        address poolAB = factory.createPool(address(tokenA), address(tokenB), 3000);
        IOmniFiPool(poolAB).initialize(TickMath.getSqrtPriceAtTick(0));

        // Create Pool B-C (fee = 3000, tickSpacing = 60)
        address poolBC = factory.createPool(address(tokenB), address(tokenC), 3000);
        IOmniFiPool(poolBC).initialize(TickMath.getSqrtPriceAtTick(0));

        // Add liquidity to Pool A-B: range [-1200, 1200]
        posManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(tokenA),
                token1: address(tokenB),
                fee: 3000,
                tickLower: -1200,
                tickUpper: 1200,
                amount0Desired: 100 ether,
                amount1Desired: 100 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 100
            })
        );

        // Add liquidity to Pool B-C: range [-1200, 1200]
        posManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(tokenB),
                token1: address(tokenC),
                fee: 3000,
                tickLower: -1200,
                tickUpper: 1200,
                amount0Desired: 100 ether,
                amount1Desired: 100 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 100
            })
        );
    }

    function test_ExactInputSingle_ZeroForOne() public {
        uint256 amountIn = 1 ether;
        vm.prank(alice);
        uint256 amountOut = router.exactInputSingle(
            IOmniFiSwapRouter.ExactInputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        assertTrue(amountOut > 0.9 ether);
        assertEq(tokenB.balanceOf(bob), amountOut);
        assertEq(tokenA.balanceOf(alice), 1000 ether - amountIn);
    }

    function test_ExactInputSingle_OneForZero() public {
        uint256 amountIn = 1 ether;
        vm.prank(alice);
        uint256 amountOut = router.exactInputSingle(
            IOmniFiSwapRouter.ExactInputSingleParams({
                tokenIn: address(tokenB),
                tokenOut: address(tokenA),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        assertTrue(amountOut > 0.9 ether);
        assertEq(tokenA.balanceOf(bob), amountOut);
        assertEq(tokenB.balanceOf(alice), 1000 ether - amountIn);
    }

    function test_ExactOutputSingle_ZeroForOne() public {
        uint256 amountOut = 1 ether;
        vm.prank(alice);
        uint256 amountIn = router.exactOutputSingle(
            IOmniFiSwapRouter.ExactOutputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: amountOut,
                amountInMaximum: 1.1 ether,
                sqrtPriceLimitX96: 0
            })
        );

        assertTrue(amountIn > 1 ether && amountIn < 1.05 ether);
        assertEq(tokenB.balanceOf(bob), amountOut);
        assertEq(tokenA.balanceOf(alice), 1000 ether - amountIn);
    }

    function test_ExactOutputSingle_OneForZero() public {
        uint256 amountOut = 1 ether;
        vm.prank(alice);
        uint256 amountIn = router.exactOutputSingle(
            IOmniFiSwapRouter.ExactOutputSingleParams({
                tokenIn: address(tokenB),
                tokenOut: address(tokenA),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: amountOut,
                amountInMaximum: 1.1 ether,
                sqrtPriceLimitX96: 0
            })
        );

        assertTrue(amountIn > 1 ether && amountIn < 1.05 ether);
        assertEq(tokenA.balanceOf(bob), amountOut);
        assertEq(tokenB.balanceOf(alice), 1000 ether - amountIn);
    }

    function test_ExactInput_MultiHop_2Hops() public {
        uint256 amountIn = 1 ether;
        bytes memory path = abi.encodePacked(
            address(tokenA), uint24(3000), address(tokenB), uint24(3000), address(tokenC)
        );

        vm.prank(alice);
        uint256 amountOut = router.exactInput(
            IOmniFiSwapRouter.ExactInputParams({
                path: path,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountIn: amountIn,
                amountOutMinimum: 0.9 ether
            })
        );

        assertTrue(amountOut > 0.9 ether);
        assertEq(tokenC.balanceOf(bob), amountOut);
        assertEq(tokenA.balanceOf(alice), 1000 ether - amountIn);
        // Ensure no intermediate token residue in router
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(tokenC.balanceOf(address(router)), 0);
    }

    function test_ExactOutput_MultiHop_2Hops() public {
        uint256 amountOut = 1 ether;
        // For exact output, path is tokenOut -> fee -> mid -> fee -> tokenIn
        bytes memory path = abi.encodePacked(
            address(tokenC), uint24(3000), address(tokenB), uint24(3000), address(tokenA)
        );

        vm.prank(alice);
        uint256 amountIn = router.exactOutput(
            IOmniFiSwapRouter.ExactOutputParams({
                path: path,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: amountOut,
                amountInMaximum: 1.1 ether
            })
        );

        assertTrue(amountIn > 1 ether && amountIn < 1.1 ether);
        assertEq(tokenC.balanceOf(bob), amountOut);
        assertEq(tokenA.balanceOf(alice), 1000 ether - amountIn);
        // Ensure no intermediate token residue in router
        assertEq(tokenA.balanceOf(address(router)), 0);
        assertEq(tokenB.balanceOf(address(router)), 0);
        assertEq(tokenC.balanceOf(address(router)), 0);
    }

    function test_SlippageExceeded_Reverts() public {
        vm.startPrank(alice);
        // Exact input slippage
        vm.expectRevert(OmniFiSwapRouter.SlippageExceeded.selector);
        router.exactInputSingle(
            IOmniFiSwapRouter.ExactInputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountIn: 1 ether,
                amountOutMinimum: 1.5 ether, // Impossible minimum
                sqrtPriceLimitX96: 0
            })
        );

        // Exact output slippage
        vm.expectRevert(OmniFiSwapRouter.SlippageExceeded.selector);
        router.exactOutputSingle(
            IOmniFiSwapRouter.ExactOutputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: 1 ether,
                amountInMaximum: 0.5 ether, // Unrealistic max
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
    }

    function test_DeadlineExpired_Reverts() public {
        vm.startPrank(alice);
        vm.expectRevert(OmniFiSwapRouter.TransactionTooOld.selector);
        router.exactInputSingle(
            IOmniFiSwapRouter.ExactInputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp - 1,
                amountIn: 1 ether,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        );

        vm.expectRevert(OmniFiSwapRouter.TransactionTooOld.selector);
        router.exactOutputSingle(
            IOmniFiSwapRouter.ExactOutputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp - 1,
                amountOut: 1 ether,
                amountInMaximum: 10 ether,
                sqrtPriceLimitX96: 0
            })
        );
        vm.stopPrank();
    }
}
