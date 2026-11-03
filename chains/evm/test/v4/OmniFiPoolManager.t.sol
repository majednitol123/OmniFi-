// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolManager } from "../../src/v4-core/OmniFiPoolManager.sol";
import { IOmniFiPoolManager } from "../../src/interfaces/IOmniFiPoolManager.sol";
import { Currency } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "../../src/v4-core/types/PoolId.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiPoolManagerTest is Test {
    using PoolIdLibrary for PoolKey;

    OmniFiPoolManager manager;
    MockERC20 tokenA;
    MockERC20 tokenB;

    Currency currency0;
    Currency currency1;

    address owner = address(0x1);
    address feeController = address(0x2);

    function setUp() external {
        manager = new OmniFiPoolManager(owner, feeController);

        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);

        address addrA = address(tokenA);
        address addrB = address(tokenB);

        if (addrA < addrB) {
            currency0 = Currency.wrap(addrA);
            currency1 = Currency.wrap(addrB);
        } else {
            currency0 = Currency.wrap(addrB);
            currency1 = Currency.wrap(addrA);
        }
    }

    function test_initialize_success() external {
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        uint160 initialSqrtPrice = TickMath.getSqrtPriceAtTick(0);
        int24 tick = manager.initialize(key, initialSqrtPrice);

        assertEq(tick, 0);

        (uint160 sqrtP, int24 currentTick, uint24 protocolFee, bool isPaused) =
            manager.getSlot0(key.toId());

        assertEq(sqrtP, initialSqrtPrice);
        assertEq(currentTick, 0);
        assertEq(protocolFee, 0);
        assertFalse(isPaused);
    }

    function test_initialize_revertsIfUnsortedOrEqual() external {
        // Equal currencies
        PoolKey memory equalKey = PoolKey({
            currency0: currency0,
            currency1: currency0,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        vm.expectRevert(IOmniFiPoolManager.CurrenciesUnsortedOrEqual.selector);
        manager.initialize(equalKey, TickMath.getSqrtPriceAtTick(0));

        // Inverted currencies
        PoolKey memory invertedKey = PoolKey({
            currency0: currency1,
            currency1: currency0,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        vm.expectRevert(IOmniFiPoolManager.CurrenciesUnsortedOrEqual.selector);
        manager.initialize(invertedKey, TickMath.getSqrtPriceAtTick(0));
    }

    function test_initialize_revertsIfHooksProvidedInR1() external {
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0x999)
        });

        vm.expectRevert(IOmniFiPoolManager.HooksNotSupportedInR1.selector);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    function test_initialize_revertsIfInvalidFeeTier() external {
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 2500, // Invalid fee tier (not 100, 500, 3000, 10000)
            tickSpacing: 60,
            hooks: address(0)
        });

        vm.expectRevert(IOmniFiPoolManager.FeeTierNotSupported.selector);
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    function test_initialize_revertsIfAlreadyInitialized() external {
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        vm.expectRevert();
        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
    }

    function test_pause_and_protocolFeeControls() external {
        PoolKey memory key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        PoolId poolId = key.toId();

        // Non-owner cannot pause
        vm.expectRevert(IOmniFiPoolManager.Unauthorized.selector);
        manager.setPoolPaused(poolId, true);

        // Owner can pause
        vm.prank(owner);
        manager.setPoolPaused(poolId, true);

        (,,, bool isPaused) = manager.getSlot0(poolId);
        assertTrue(isPaused);

        // Fee controller can set protocol fee
        vm.prank(feeController);
        manager.setProtocolFee(poolId, 100_000); // 10%

        (,, uint24 protocolFee,) = manager.getSlot0(poolId);
        assertEq(protocolFee, 100_000);
    }
}

