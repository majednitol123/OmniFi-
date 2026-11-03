// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiPoolFactoryTest is Test {
    OmniFiPoolFactory internal factory;
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);

    function setUp() public {
        factory = new OmniFiPoolFactory(owner, feeRecipient);
        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);
    }

    function test_InitialState() public view {
        assertEq(factory.owner(), owner);
        assertEq(factory.feeRecipient(), feeRecipient);
        assertEq(factory.defaultProtocolFeeFraction(), 0);
        assertEq(factory.feeTierTickSpacing(100), 1);
        assertEq(factory.feeTierTickSpacing(500), 10);
        assertEq(factory.feeTierTickSpacing(3000), 60);
        assertEq(factory.feeTierTickSpacing(10_000), 200);
    }

    function test_CreatePool() public {
        address pool = factory.createPool(address(tokenA), address(tokenB), 3000);
        assertTrue(pool != address(0));

        assertEq(factory.getPool(address(tokenA), address(tokenB), 3000), pool);
        assertEq(factory.getPool(address(tokenB), address(tokenA), 3000), pool);
        assertEq(factory.allPoolsLength(), 1);
        assertEq(factory.allPools(0), pool);

        OmniFiPool p = OmniFiPool(pool);
        assertEq(p.factory(), address(factory));
        assertEq(p.fee(), 3000);
        assertEq(p.tickSpacing(), 60);
    }

    function test_CreatePool_Reverts() public {
        // Identical tokens
        vm.expectRevert(OmniFiPoolFactory.IdenticalAddresses.selector);
        factory.createPool(address(tokenA), address(tokenA), 3000);

        // Zero address
        vm.expectRevert(OmniFiPoolFactory.ZeroAddress.selector);
        factory.createPool(address(tokenA), address(0), 3000);

        // Unsupported fee tier
        vm.expectRevert(OmniFiPoolFactory.FeeTierNotSupported.selector);
        factory.createPool(address(tokenA), address(tokenB), 2500);

        // Duplicate pool
        factory.createPool(address(tokenA), address(tokenB), 3000);
        vm.expectRevert(OmniFiPoolFactory.PoolAlreadyExists.selector);
        factory.createPool(address(tokenA), address(tokenB), 3000);
    }

    function test_EnableFeeTier() public {
        vm.prank(owner);
        factory.enableFeeTier(2000, 40);
        assertEq(factory.feeTierTickSpacing(2000), 40);

        // Not owner
        vm.expectRevert(OmniFiPoolFactory.NotOwner.selector);
        factory.enableFeeTier(4000, 80);
    }

    function test_SetFeeRecipient() public {
        address newRecipient = address(0xCC);
        vm.prank(owner);
        factory.setFeeRecipient(newRecipient);
        assertEq(factory.feeRecipient(), newRecipient);

        vm.expectRevert(OmniFiPoolFactory.NotOwner.selector);
        factory.setFeeRecipient(address(0xDD));
    }

    function test_SetDefaultProtocolFeeFraction() public {
        vm.prank(owner);
        factory.setDefaultProtocolFeeFraction(1); // 25% of fee
        assertEq(factory.defaultProtocolFeeFraction(), 1);

        vm.expectRevert(OmniFiPoolFactory.InvalidProtocolFeeFraction.selector);
        vm.prank(owner);
        factory.setDefaultProtocolFeeFraction(5);
    }
}
