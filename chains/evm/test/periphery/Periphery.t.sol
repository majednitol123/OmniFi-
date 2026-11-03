// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { Multicall } from "../../src/periphery/Multicall.sol";
import { PeripheryPayments } from "../../src/periphery/PeripheryPayments.sol";
import { PeripheryValidation } from "../../src/periphery/PeripheryValidation.sol";
import { IWETH9 } from "../../src/interfaces/IWETH9.sol";
import { MockWETH9 } from "../helpers/MockWETH9.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPositionManager } from "../../src/clmm/OmniFiPositionManager.sol";
import { OmniFiSwapRouter } from "../../src/clmm/OmniFiSwapRouter.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { IOmniFiSwapRouter } from "../../src/interfaces/IOmniFiSwapRouter.sol";
import { IOmniFiPositionManager } from "../../src/interfaces/IOmniFiPositionManager.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Router } from "../../src/v2/OmniFiV2Router.sol";
import { IOmniFiV2Router } from "../../src/interfaces/IOmniFiV2Router.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";

/// @dev Concrete test harness inheriting PeripheryPayments, Multicall, and PeripheryValidation
contract PeripheryHarness is Multicall, PeripheryPayments, PeripheryValidation {
    uint256 public counter;

    error CustomErrorWithParam(uint256 code);

    constructor(address _weth) PeripheryPayments(_weth) {}

    function increment(uint256 amount) external returns (uint256) {
        counter += amount;
        return counter;
    }

    function functionThatRevertsCustom(uint256 code) external pure {
        revert CustomErrorWithParam(code);
    }

    function functionThatRevertsString(string memory message) external pure {
        revert(message);
    }

    function functionThatRevertsEmpty() external pure {
        assembly {
            revert(0, 0)
        }
    }

    function validatedAction(uint256 deadline, uint256 amount)
        external
        checkDeadline(deadline)
        returns (uint256)
    {
        counter += amount;
        return counter;
    }
}

contract PeripheryTest is Test {
    MockWETH9 public weth;
    MockERC20 public tokenA;
    MockERC20 public tokenB;
    PeripheryHarness public harness;

    OmniFiPoolFactory public clmmFactory;
    OmniFiPositionManager public clmmPosManager;
    OmniFiSwapRouter public clmmRouter;

    OmniFiV2Factory public v2Factory;
    OmniFiV2Router public v2Router;

    address public alice = address(0x1111);
    address public bob = address(0x2222);

    function setUp() public {
        weth = new MockWETH9();
        harness = new PeripheryHarness(address(weth));

        // Create sorted tokens tokenA < tokenB
        MockERC20 t1 = new MockERC20("Token 1", "TK1", 18);
        MockERC20 t2 = new MockERC20("Token 2", "TK2", 18);
        if (address(t1) < address(t2)) {
            tokenA = t1;
            tokenB = t2;
        } else {
            tokenA = t2;
            tokenB = t1;
        }

        // Deploy CLMM system
        clmmFactory = new OmniFiPoolFactory(address(this), address(this));
        clmmPosManager = new OmniFiPositionManager(address(clmmFactory));
        clmmRouter = new OmniFiSwapRouter(address(clmmFactory));

        // Deploy V2 system
        v2Factory = new OmniFiV2Factory(address(this), address(this));
        v2Router = new OmniFiV2Router(address(v2Factory));

        // Fund accounts
        vm.deal(alice, 100 ether);
        vm.deal(bob, 100 ether);
        vm.deal(address(this), 100 ether);

        tokenA.mint(alice, 10_000 ether);
        tokenB.mint(alice, 10_000 ether);
        tokenA.mint(address(this), 100_000 ether);
        tokenB.mint(address(this), 100_000 ether);
        tokenA.mint(address(harness), 500 ether);

        // Approve routers
        tokenA.approve(address(clmmPosManager), type(uint256).max);
        tokenB.approve(address(clmmPosManager), type(uint256).max);
        tokenA.approve(address(v2Router), type(uint256).max);
        tokenB.approve(address(v2Router), type(uint256).max);

        vm.startPrank(alice);
        tokenA.approve(address(clmmRouter), type(uint256).max);
        tokenB.approve(address(clmmRouter), type(uint256).max);
        tokenA.approve(address(clmmPosManager), type(uint256).max);
        tokenB.approve(address(clmmPosManager), type(uint256).max);
        tokenA.approve(address(v2Router), type(uint256).max);
        tokenB.approve(address(v2Router), type(uint256).max);
        vm.stopPrank();
    }

    // -----------------------------------------------------------------------
    // Multicall Core Tests
    // -----------------------------------------------------------------------

    function test_Multicall_BatchIncrements() public {
        bytes[] memory calls = new bytes[](3);
        calls[0] = abi.encodeWithSelector(PeripheryHarness.increment.selector, 10);
        calls[1] = abi.encodeWithSelector(PeripheryHarness.increment.selector, 20);
        calls[2] = abi.encodeWithSelector(PeripheryHarness.increment.selector, 30);

        bytes[] memory results = harness.multicall(calls);
        assertEq(results.length, 3);
        assertEq(abi.decode(results[0], (uint256)), 10);
        assertEq(abi.decode(results[1], (uint256)), 30);
        assertEq(abi.decode(results[2], (uint256)), 60);
        assertEq(harness.counter(), 60);
    }

    function test_Multicall_RevertsBubblesCustomError() public {
        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeWithSelector(PeripheryHarness.increment.selector, 5);
        calls[1] = abi.encodeWithSelector(PeripheryHarness.functionThatRevertsCustom.selector, 404);

        vm.expectRevert(abi.encodeWithSelector(PeripheryHarness.CustomErrorWithParam.selector, 404));
        harness.multicall(calls);

        // State remains unchanged due to revert
        assertEq(harness.counter(), 0);
    }

    function test_Multicall_RevertsBubblesStringError() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(PeripheryHarness.functionThatRevertsString.selector, "Boom!");

        vm.expectRevert(bytes("Boom!"));
        harness.multicall(calls);
    }

    function test_Multicall_RevertsBubblesEmptyRevert() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(PeripheryHarness.functionThatRevertsEmpty.selector);

        vm.expectRevert(abi.encodeWithSelector(Multicall.MulticallFailed.selector));
        harness.multicall(calls);
    }

    // -----------------------------------------------------------------------
    // PeripheryValidation Tests
    // -----------------------------------------------------------------------

    function test_PeripheryValidation_CheckDeadline_PassesBeforeDeadline() public {
        vm.warp(1000);
        uint256 res = harness.validatedAction(1005, 15);
        assertEq(res, 15);
        assertEq(harness.counter(), 15);
    }

    function test_PeripheryValidation_CheckDeadline_RevertsAfterDeadline() public {
        vm.warp(1000);
        vm.expectRevert(abi.encodeWithSelector(PeripheryValidation.TransactionExpired.selector));
        harness.validatedAction(999, 15);
    }

    // -----------------------------------------------------------------------
    // PeripheryPayments Tests
    // -----------------------------------------------------------------------

    function test_PeripheryPayments_UnwrapWETH9_Success() public {
        vm.deal(address(this), 10 ether);
        weth.deposit{value: 10 ether}();
        weth.transfer(address(harness), 10 ether);

        assertEq(weth.balanceOf(address(harness)), 10 ether);
        uint256 bobBalBefore = bob.balance;

        harness.unwrapWETH9(10 ether, bob);

        assertEq(weth.balanceOf(address(harness)), 0);
        assertEq(bob.balance, bobBalBefore + 10 ether);
    }

    function test_PeripheryPayments_UnwrapWETH9_RevertsIfInsufficient() public {
        weth.deposit{value: 5 ether}();
        weth.transfer(address(harness), 5 ether);

        vm.expectRevert(abi.encodeWithSelector(PeripheryPayments.InsufficientOutput.selector));
        harness.unwrapWETH9(10 ether, bob);
    }

    function test_PeripheryPayments_RefundETH_Success() public {
        vm.deal(address(harness), 3 ether);

        uint256 aliceBalBefore = alice.balance;
        vm.prank(alice);
        harness.refundETH();

        assertEq(address(harness).balance, 0);
        assertEq(alice.balance, aliceBalBefore + 3 ether);
    }

    function test_PeripheryPayments_SweepToken_Success() public {
        assertEq(tokenA.balanceOf(address(harness)), 500 ether);
        uint256 bobTokensBefore = tokenA.balanceOf(bob);

        harness.sweepToken(address(tokenA), 500 ether, bob);

        assertEq(tokenA.balanceOf(address(harness)), 0);
        assertEq(tokenA.balanceOf(bob), bobTokensBefore + 500 ether);
    }

    function test_PeripheryPayments_SweepToken_RevertsIfInsufficient() public {
        vm.expectRevert(abi.encodeWithSelector(PeripheryPayments.InsufficientOutput.selector));
        harness.sweepToken(address(tokenA), 501 ether, bob);
    }

    function test_PeripheryPayments_Receive_RevertsIfNotWETH() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PeripheryPayments.NotWETH9.selector));
        (bool success,) = address(harness).call{value: 1 ether}("");
        assertTrue(success);
    }

    // -----------------------------------------------------------------------
    // Multicall on V2 Router Tests
    // -----------------------------------------------------------------------

    function test_OmniFiV2Router_Multicall_AddLiquidity() public {
        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(
            IOmniFiV2Router.addLiquidity.selector,
            address(tokenA),
            address(tokenB),
            100 ether,
            200 ether,
            100 ether,
            200 ether,
            address(this),
            block.timestamp + 100
        );

        bytes[] memory results = v2Router.multicall(calls);
        assertEq(results.length, 1);
        (uint256 amountA, uint256 amountB, uint256 liquidity) =
            abi.decode(results[0], (uint256, uint256, uint256));
        assertEq(amountA, 100 ether);
        assertEq(amountB, 200 ether);
        assertTrue(liquidity > 0);
    }

    // -----------------------------------------------------------------------
    // Multicall on CLMM Router & Position Manager Tests
    // -----------------------------------------------------------------------

    function test_OmniFiPositionManager_Multicall_CreateAndMint() public {
        address pool = clmmFactory.createPool(address(tokenA), address(tokenB), 3000);
        IOmniFiPool(pool).initialize(TickMath.getSqrtPriceAtTick(0));

        IOmniFiPositionManager.MintParams memory params = IOmniFiPositionManager.MintParams({
            token0: address(tokenA),
            token1: address(tokenB),
            fee: 3000,
            tickLower: -1200,
            tickUpper: 1200,
            amount0Desired: 100 ether,
            amount1Desired: 100 ether,
            amount0Min: 0,
            amount1Min: 0,
            recipient: alice,
            deadline: block.timestamp + 100
        });

        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(clmmPosManager.mint.selector, params);

        vm.prank(alice);
        bytes[] memory results = clmmPosManager.multicall(calls);
        assertEq(results.length, 1);

        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) =
            abi.decode(results[0], (uint256, uint128, uint256, uint256));

        assertEq(tokenId, 1);
        assertTrue(liquidity > 0);
        assertTrue(amount0 > 0);
        assertTrue(amount1 > 0);
        assertEq(clmmPosManager.ownerOf(1), alice);
    }

    function test_OmniFiSwapRouter_Multicall_ExactInputSingle() public {
        address pool = clmmFactory.createPool(address(tokenA), address(tokenB), 3000);
        IOmniFiPool(pool).initialize(TickMath.getSqrtPriceAtTick(0));

        clmmPosManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(tokenA),
                token1: address(tokenB),
                fee: 3000,
                tickLower: -1200,
                tickUpper: 1200,
                amount0Desired: 1000 ether,
                amount1Desired: 1000 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: address(this),
                deadline: block.timestamp + 100
            })
        );

        IOmniFiSwapRouter.ExactInputSingleParams memory params = IOmniFiSwapRouter.ExactInputSingleParams({
            tokenIn: address(tokenA),
            tokenOut: address(tokenB),
            fee: 3000,
            recipient: alice,
            deadline: block.timestamp + 100,
            amountIn: 10 ether,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        bytes[] memory calls = new bytes[](1);
        calls[0] = abi.encodeWithSelector(clmmRouter.exactInputSingle.selector, params);

        uint256 aliceBalBBefore = tokenB.balanceOf(alice);
        vm.prank(alice);
        bytes[] memory results = clmmRouter.multicall(calls);
        assertEq(results.length, 1);

        uint256 amountOut = abi.decode(results[0], (uint256));
        assertTrue(amountOut > 0);
        assertEq(tokenB.balanceOf(alice), aliceBalBBefore + amountOut);
    }
}
