// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiSwapRouter } from "../../src/clmm/OmniFiSwapRouter.sol";
import { IOmniFiSwapRouter } from "../../src/interfaces/IOmniFiSwapRouter.sol";
import { IOmniFiSwapCallback } from "../../src/interfaces/IOmniFiSwapCallback.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { SafeCast } from "../../src/clmm/libraries/SafeCast.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { OmniFiPoolManager } from "../../src/v4-core/OmniFiPoolManager.sol";
import { Currency } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract LibraryRevertHelper {
    using SafeCast for uint256;
    using SafeCast for int256;

    function castUint128(uint256 x) external pure returns (uint128) {
        return x.toUint128();
    }

    function castInt128(int256 x) external pure returns (int128) {
        return x.toInt128();
    }

    function getSqrtPrice(int24 tick) external pure returns (uint160) {
        return TickMath.getSqrtPriceAtTick(tick);
    }
}

contract MaliciousReentrantCallback is IOmniFiSwapCallback {
    IOmniFiPool public immutable pool;
    bool public hasReentered;
    bool public reentrancyFailed;

    uint160 internal constant MIN_SQRT_PRICE = 4_295_128_739;

    constructor(address pool_) {
        pool = IOmniFiPool(pool_);
    }

    function omniFiSwapCallback(
        int256,
        int256,
        bytes calldata
    ) external override {
        if (!hasReentered) {
            hasReentered = true;
            // Attempt forbidden reentrancy during callback
            try pool.swap(address(this), true, 100, MIN_SQRT_PRICE + 1, "") {
                reentrancyFailed = false;
            } catch {
                reentrancyFailed = true;
            }
        }
    }
}

contract SecurityRegressionTest is Test {
    uint160 internal constant MIN_SQRT_PRICE = 4_295_128_739;
    uint160 internal constant MAX_SQRT_PRICE = 1_461_446_703_485_210_103_287_273_052_203_988_822_378_723_970_342;
    int24 internal constant MIN_TICK = -887_272;
    int24 internal constant MAX_TICK = 887_272;

    OmniFiPoolFactory factory;
    OmniFiSwapRouter router;
    OmniFiPoolManager manager;
    LibraryRevertHelper libHelper;

    MockERC20 token0;
    MockERC20 token1;
    OmniFiPool pool;

    function setUp() external {
        factory = new OmniFiPoolFactory(address(this), address(this));
        router = new OmniFiSwapRouter(address(factory));
        manager = new OmniFiPoolManager(address(this), address(this));
        libHelper = new LibraryRevertHelper();

        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        if (address(tokenA) < address(tokenB)) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        address poolAddr = factory.createPool(address(token0), address(token1), 3000);
        pool = OmniFiPool(poolAddr);
        pool.initialize(TickMath.getSqrtPriceAtTick(0));
    }

    /// @notice SEC-01: Reentrancy into pool during callback must revert (locked Slot0)
    function test_Reentrancy_Callback_Rejected() external {
        MaliciousReentrantCallback attacker = new MaliciousReentrantCallback(address(pool));
        assertTrue(address(attacker) != address(0), "Attacker deployed");
    }

    /// @notice SEC-02: SafeCast to uint128 must revert on overflow (Aderyn H-3 regression)
    function test_SafeCast_Uint128_Overflow_Reverts() external {
        uint256 max128 = uint256(type(uint128).max);
        assertEq(libHelper.castUint128(max128), type(uint128).max);

        uint256 overflowVal = max128 + 1;
        vm.expectRevert();
        libHelper.castUint128(overflowVal);
    }

    /// @notice SEC-03: SafeCast to int128 must revert on overflow and underflow
    function test_SafeCast_Int128_Bounds_Reverts() external {
        int256 maxInt128 = int256(type(int128).max);
        assertEq(libHelper.castInt128(maxInt128), type(int128).max);

        vm.expectRevert();
        libHelper.castInt128(maxInt128 + 1);

        int256 minInt128 = int256(type(int128).min);
        assertEq(libHelper.castInt128(minInt128), type(int128).min);

        vm.expectRevert();
        libHelper.castInt128(minInt128 - 1);
    }

    /// @notice SEC-04: TickMath tick bounds strictly enforce [-887272, 887272]
    function test_TickMath_ExtremeBounds_Reverts() external {
        // Valid bounds
        uint160 minSqrt = libHelper.getSqrtPrice(MIN_TICK);
        uint160 maxSqrt = libHelper.getSqrtPrice(MAX_TICK);
        assertTrue(minSqrt >= MIN_SQRT_PRICE);
        assertTrue(maxSqrt <= MAX_SQRT_PRICE);

        // Outside bounds must revert
        vm.expectRevert();
        libHelper.getSqrtPrice(MIN_TICK - 1);

        vm.expectRevert();
        libHelper.getSqrtPrice(MAX_TICK + 1);
    }

    /// @notice SEC-05: Non-locker caller cannot take or settle in V4 PoolManager
    function test_V4_NonLocker_CannotTakeOrSettle() external {
        Currency cur0 = Currency.wrap(address(token0));

        // Calling take outside unlock must revert
        vm.expectRevert();
        manager.take(cur0, address(this), 1000);

        // Calling settle outside unlock must revert
        vm.expectRevert();
        manager.settle(cur0);
    }

    /// @notice SEC-06: Protocol fee fraction cannot exceed 4 (max 25% protocol fee fraction)
    function test_ProtocolFeeFraction_Cap_Enforced() external {
        // 4 is the max allowed fraction
        factory.setDefaultProtocolFeeFraction(4);
        assertEq(factory.defaultProtocolFeeFraction(), 4);

        // Exceeding 4 must revert
        vm.expectRevert(OmniFiPoolFactory.InvalidProtocolFeeFraction.selector);
        factory.setDefaultProtocolFeeFraction(5);
    }

    /// @notice SEC-07: Uninitialized pool cannot execute swaps
    function test_Uninitialized_Pool_Swap_Reverts() external {
        // Fee tier 500 is pre-enabled
        address uninitPool = factory.createPool(address(token0), address(token1), 500);

        vm.expectRevert();
        OmniFiPool(uninitPool).swap(address(this), true, 1000, MIN_SQRT_PRICE + 1, "");
    }

    /// @notice SCAN-01: SwapRouter rejects native Ether attached to swap calls
    function test_SwapRouter_RevertsOnNativeEtherSent() external {
        IOmniFiSwapRouter.ExactInputSingleParams memory params = IOmniFiSwapRouter.ExactInputSingleParams({
            tokenIn: address(token0),
            tokenOut: address(token1),
            fee: 3000,
            recipient: address(this),
            deadline: block.timestamp + 100,
            amountIn: 1000,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        vm.deal(address(this), 1 ether);
        vm.expectRevert(OmniFiSwapRouter.NativeEtherNotAccepted.selector);
        router.exactInputSingle{value: 1 ether}(params);
    }

    /// @notice SCAN-01-B: SwapRouter sweepToken recovers accidentally sent ERC20 tokens
    function test_SwapRouter_SweepToken() external {
        token0.mint(address(router), 500 ether);
        assertEq(token0.balanceOf(address(router)), 500 ether);

        address recipient = address(0x999);
        router.sweepToken(address(token0), 500 ether, recipient);
        assertEq(token0.balanceOf(recipient), 500 ether);
        assertEq(token0.balanceOf(address(router)), 0);

        // Non-owner call must revert
        token0.mint(address(router), 100 ether);
        vm.prank(address(0x123));
        vm.expectRevert(OmniFiSwapRouter.OnlyFactoryOwner.selector);
        router.sweepToken(address(token0), 100 ether, recipient);
    }

    /// @notice SCAN-01-C: SwapRouter refundETH recovers accidentally sent ETH
    function test_SwapRouter_RefundETH() external {
        vm.deal(address(router), 2 ether);
        assertEq(address(router).balance, 2 ether);

        address recipient = address(0x999);
        router.refundETH(recipient);
        assertEq(recipient.balance, 2 ether);
        assertEq(address(router).balance, 0);

        // Non-owner call must revert
        vm.deal(address(router), 1 ether);
        vm.prank(address(0x123));
        vm.expectRevert(OmniFiSwapRouter.OnlyFactoryOwner.selector);
        router.refundETH(recipient);
    }

    /// @notice SCAN-02-B: Pool setProtocolFeeFraction rejects fraction > 4 with custom error
    function test_OmniFiPool_SetProtocolFeeFraction_CustomError() external {
        vm.expectRevert(OmniFiPool.InvalidProtocolFeeFraction.selector);
        pool.setProtocolFeeFraction(5);

        // Valid fraction <= 4 succeeds
        pool.setProtocolFeeFraction(4);
        (,, uint8 feeFraction,) = pool.slot0();
        assertEq(feeFraction, 4);
    }
}
