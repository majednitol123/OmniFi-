// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { IOmniFiV2Factory } from "../../src/interfaces/IOmniFiV2Factory.sol";
import { IOmniFiV2Pair } from "../../src/interfaces/IOmniFiV2Pair.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiV2FactoryTest is Test {
    OmniFiV2Factory internal factory;
    MockERC20 internal tokenA;
    MockERC20 internal tokenB;
    MockERC20 internal tokenC;

    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal user = address(0xCC);

    function setUp() public {
        factory = new OmniFiV2Factory(owner, feeRecipient);
        tokenA = new MockERC20("Token A", "TKNA", 18);
        tokenB = new MockERC20("Token B", "TKNB", 18);
        tokenC = new MockERC20("Token C", "TKNC", 18);
    }

    function test_CreatePair_Success() public {
        address pair = factory.createPair(address(tokenA), address(tokenB));
        assertTrue(pair != address(0));

        assertEq(factory.getPair(address(tokenA), address(tokenB)), pair);
        assertEq(factory.getPair(address(tokenB), address(tokenA)), pair);
        assertEq(factory.allPairsLength(), 1);
        assertEq(factory.allPairs(0), pair);

        (address token0, address token1) = address(tokenA) < address(tokenB)
            ? (address(tokenA), address(tokenB))
            : (address(tokenB), address(tokenA));

        assertEq(IOmniFiV2Pair(pair).token0(), token0);
        assertEq(IOmniFiV2Pair(pair).token1(), token1);
        assertEq(IOmniFiV2Pair(pair).factory(), address(factory));
    }

    function test_CreatePair_IdenticalAddresses_Reverts() public {
        vm.expectRevert(IOmniFiV2Factory.IdenticalAddresses.selector);
        factory.createPair(address(tokenA), address(tokenA));
    }

    function test_CreatePair_ZeroAddress_Reverts() public {
        vm.expectRevert(IOmniFiV2Factory.ZeroAddress.selector);
        factory.createPair(address(0), address(tokenA));
    }

    function test_CreatePair_PairExists_Reverts() public {
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(IOmniFiV2Factory.PairExists.selector);
        factory.createPair(address(tokenA), address(tokenB));

        vm.expectRevert(IOmniFiV2Factory.PairExists.selector);
        factory.createPair(address(tokenB), address(tokenA));
    }

    function test_SetProtocolFeeFraction_Success() public {
        assertEq(factory.protocolFeeFraction(), 0);

        vm.prank(owner);
        factory.setProtocolFeeFraction(1);
        assertEq(factory.protocolFeeFraction(), 1);

        vm.prank(owner);
        factory.setProtocolFeeFraction(0);
        assertEq(factory.protocolFeeFraction(), 0);
    }

    function test_SetProtocolFeeFraction_Unauthorized_Reverts() public {
        vm.prank(user);
        vm.expectRevert(IOmniFiV2Factory.Unauthorized.selector);
        factory.setProtocolFeeFraction(1);
    }

    function test_SetProtocolFeeFraction_ExceedsMax_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(IOmniFiV2Factory.ExceedsMaxProtocolFee.selector);
        factory.setProtocolFeeFraction(2); // > 1
    }

    function test_SetFeeRecipient_Success() public {
        address newRecipient = address(0xDD);

        vm.prank(owner);
        factory.setFeeRecipient(newRecipient);
        assertEq(factory.feeRecipient(), newRecipient);
    }

    function test_SetFeeRecipient_Unauthorized_Reverts() public {
        vm.prank(user);
        vm.expectRevert(IOmniFiV2Factory.Unauthorized.selector);
        factory.setFeeRecipient(address(0xDD));
    }

    function test_SetFeeRecipient_ZeroAddress_Reverts() public {
        vm.prank(owner);
        vm.expectRevert(IOmniFiV2Factory.ZeroAddress.selector);
        factory.setFeeRecipient(address(0));
    }

    function test_SetOwner_Success() public {
        address newOwner = address(0xEE);

        vm.prank(owner);
        factory.setOwner(newOwner);
        assertEq(factory.owner(), newOwner);

        // Old owner no longer authorized
        vm.prank(owner);
        vm.expectRevert(IOmniFiV2Factory.Unauthorized.selector);
        factory.setProtocolFeeFraction(1);

        // New owner authorized
        vm.prank(newOwner);
        factory.setProtocolFeeFraction(1);
        assertEq(factory.protocolFeeFraction(), 1);
    }
}
