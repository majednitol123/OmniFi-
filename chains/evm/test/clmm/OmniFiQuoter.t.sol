// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPositionManager } from "../../src/clmm/OmniFiPositionManager.sol";
import { OmniFiSwapRouter } from "../../src/clmm/OmniFiSwapRouter.sol";
import { OmniFiQuoter } from "../../src/clmm/OmniFiQuoter.sol";
import { IOmniFiSwapRouter } from "../../src/interfaces/IOmniFiSwapRouter.sol";
import { IOmniFiPositionManager } from "../../src/interfaces/IOmniFiPositionManager.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiQuoterTest is Test {
    OmniFiPoolFactory public factory;
    OmniFiPositionManager public posManager;
    OmniFiSwapRouter public router;
    OmniFiQuoter public quoter;

    MockERC20 public tokenA;
    MockERC20 public tokenB;
    MockERC20 public tokenC;

    address public alice = address(0x1111);
    address public bob = address(0x2222);

    function setUp() public {
        factory = new OmniFiPoolFactory(address(this), address(this));
        posManager = new OmniFiPositionManager(address(factory));
        router = new OmniFiSwapRouter(address(factory));
        quoter = new OmniFiQuoter(address(factory));

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

        tokenA.mint(address(this), 10_000 ether);
        tokenB.mint(address(this), 10_000 ether);
        tokenC.mint(address(this), 10_000 ether);

        tokenA.mint(alice, 1000 ether);
        tokenB.mint(alice, 1000 ether);
        tokenC.mint(alice, 1000 ether);

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

        address poolAB = factory.createPool(address(tokenA), address(tokenB), 3000);
        IOmniFiPool(poolAB).initialize(TickMath.getSqrtPriceAtTick(0));

        address poolBC = factory.createPool(address(tokenB), address(tokenC), 3000);
        IOmniFiPool(poolBC).initialize(TickMath.getSqrtPriceAtTick(0));

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

    function test_QuoteMatchesActual_ExactInputSingle() public {
        uint256 amountIn = 1 ether;

        // Obtain quote
        uint256 quotedOut =
            quoter.quoteExactInputSingle(address(tokenA), address(tokenB), 3000, amountIn, 0);

        // Execute actual swap
        vm.prank(alice);
        uint256 actualOut = router.exactInputSingle(
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

        assertEq(quotedOut, actualOut);
    }

    function test_QuoteMatchesActual_ExactOutputSingle() public {
        uint256 amountOut = 1 ether;

        // Obtain quote
        uint256 quotedIn =
            quoter.quoteExactOutputSingle(address(tokenA), address(tokenB), 3000, amountOut, 0);

        // Execute actual swap
        vm.prank(alice);
        uint256 actualIn = router.exactOutputSingle(
            IOmniFiSwapRouter.ExactOutputSingleParams({
                tokenIn: address(tokenA),
                tokenOut: address(tokenB),
                fee: 3000,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: amountOut,
                amountInMaximum: type(uint256).max,
                sqrtPriceLimitX96: 0
            })
        );

        assertEq(quotedIn, actualIn);
    }

    function test_QuoteMatchesActual_ExactInput_MultiHop() public {
        uint256 amountIn = 1 ether;
        bytes memory path = abi.encodePacked(
            address(tokenA), uint24(3000), address(tokenB), uint24(3000), address(tokenC)
        );

        uint256 quotedOut = quoter.quoteExactInput(path, amountIn);

        vm.prank(alice);
        uint256 actualOut = router.exactInput(
            IOmniFiSwapRouter.ExactInputParams({
                path: path,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountIn: amountIn,
                amountOutMinimum: 0
            })
        );

        assertEq(quotedOut, actualOut);
    }

    function test_QuoteMatchesActual_ExactOutput_MultiHop() public {
        uint256 amountOut = 1 ether;
        bytes memory path = abi.encodePacked(
            address(tokenC), uint24(3000), address(tokenB), uint24(3000), address(tokenA)
        );

        uint256 quotedIn = quoter.quoteExactOutput(path, amountOut);

        vm.prank(alice);
        uint256 actualIn = router.exactOutput(
            IOmniFiSwapRouter.ExactOutputParams({
                path: path,
                recipient: bob,
                deadline: block.timestamp + 100,
                amountOut: amountOut,
                amountInMaximum: type(uint256).max
            })
        );

        assertEq(quotedIn, actualIn);
    }

    function test_Quote_PoolDoesNotExist_Reverts() public {
        vm.expectRevert(OmniFiQuoter.PoolDoesNotExist.selector);
        quoter.quoteExactInputSingle(address(tokenA), address(tokenC), 3000, 1 ether, 0);
    }
}
