// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { OmniFiPositionManager } from "../../src/clmm/OmniFiPositionManager.sol";
import { IOmniFiPositionManager } from "../../src/interfaces/IOmniFiPositionManager.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiPositionManagerTest is Test {
    OmniFiPoolFactory internal factory;
    OmniFiPositionManager internal positionManager;
    OmniFiPool internal pool;
    MockERC20 internal token0;
    MockERC20 internal token1;

    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal alice = address(0x111);
    address internal bob = address(0x222);

    uint160 internal constant SQRT_RATIO_1_1 = 79_228_162_514_264_337_593_543_950_336;

    function setUp() public {
        factory = new OmniFiPoolFactory(owner, feeRecipient);
        positionManager = new OmniFiPositionManager(address(factory));

        MockERC20 tA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tB = new MockERC20("Token B", "TKNB", 18);

        if (address(tA) < address(tB)) {
            token0 = tA;
            token1 = tB;
        } else {
            token0 = tB;
            token1 = tA;
        }

        address poolAddr = factory.createPool(address(token0), address(token1), 3000);
        pool = OmniFiPool(poolAddr);
        pool.initialize(SQRT_RATIO_1_1);

        // Fund alice
        token0.mint(alice, 1000 ether);
        token1.mint(alice, 1000 ether);

        // Fund bob
        token0.mint(bob, 1000 ether);
        token1.mint(bob, 1000 ether);

        // Approve positionManager
        vm.prank(alice);
        token0.approve(address(positionManager), type(uint256).max);
        vm.prank(alice);
        token1.approve(address(positionManager), type(uint256).max);

        vm.prank(bob);
        token0.approve(address(positionManager), type(uint256).max);
        vm.prank(bob);
        token1.approve(address(positionManager), type(uint256).max);
    }

    function test_Mint_ERC721Position() public {
        vm.prank(alice);
        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        assertEq(tokenId, 1);
        assertTrue(liquidity > 0);
        assertTrue(amount0 > 0);
        assertTrue(amount1 > 0);
        assertEq(positionManager.ownerOf(tokenId), alice);

        IOmniFiPositionManager.Position memory pos = positionManager.positions(tokenId);
        assertEq(pos.token0, address(token0));
        assertEq(pos.token1, address(token1));
        assertEq(pos.fee, 3000);
        assertEq(pos.tickLower, -60);
        assertEq(pos.tickUpper, 60);
        assertEq(pos.liquidity, liquidity);
    }

    function test_IncreaseLiquidity() public {
        vm.prank(alice);
        (uint256 tokenId, uint128 lInit,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        vm.prank(alice);
        (uint128 lAdded, uint256 a0, uint256 a1) = positionManager.increaseLiquidity(
            IOmniFiPositionManager.IncreaseLiquidityParams({
                tokenId: tokenId,
                amount0Desired: 0.5 ether,
                amount1Desired: 0.5 ether,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1000
            })
        );

        assertTrue(lAdded > 0);
        assertTrue(a0 > 0);
        assertTrue(a1 > 0);

        IOmniFiPositionManager.Position memory pos = positionManager.positions(tokenId);
        assertEq(pos.liquidity, lInit + lAdded);
    }

    function test_DecreaseLiquidity_And_Collect() public {
        vm.prank(alice);
        (uint256 tokenId, uint128 lInit,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 10 ether,
                amount1Desired: 10 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        // Decrease half
        vm.prank(alice);
        (uint256 a0Burned, uint256 a1Burned) = positionManager.decreaseLiquidity(
            IOmniFiPositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: lInit / 2,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1000
            })
        );

        assertTrue(a0Burned > 0);
        assertTrue(a1Burned > 0);

        IOmniFiPositionManager.Position memory pos = positionManager.positions(tokenId);
        assertEq(pos.liquidity, lInit - lInit / 2);
        assertEq(pos.tokensOwed0, a0Burned);
        assertEq(pos.tokensOwed1, a1Burned);

        // Collect
        uint256 bal0Before = token0.balanceOf(alice);
        uint256 bal1Before = token1.balanceOf(alice);

        vm.prank(alice);
        (uint256 c0, uint256 c1) = positionManager.collect(
            IOmniFiPositionManager.CollectParams({
                tokenId: tokenId,
                recipient: alice,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        assertEq(c0, a0Burned);
        assertEq(c1, a1Burned);
        assertEq(token0.balanceOf(alice) - bal0Before, c0);
        assertEq(token1.balanceOf(alice) - bal1Before, c1);
    }

    function test_Burn_Position() public {
        vm.prank(alice);
        (uint256 tokenId, uint128 lInit,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        // Cannot burn before removing all liquidity
        vm.expectRevert(OmniFiPositionManager.PositionNotEmpty.selector);
        vm.prank(alice);
        positionManager.burn(tokenId);

        // Decrease all
        vm.prank(alice);
        positionManager.decreaseLiquidity(
            IOmniFiPositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: lInit,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1000
            })
        );

        // Collect all
        vm.prank(alice);
        positionManager.collect(
            IOmniFiPositionManager.CollectParams({
                tokenId: tokenId,
                recipient: alice,
                amount0Max: type(uint128).max,
                amount1Max: type(uint128).max
            })
        );

        // Now burn succeeds
        vm.prank(alice);
        positionManager.burn(tokenId);

        // Token should no longer exist
        vm.expectRevert();
        positionManager.ownerOf(tokenId);
    }

    function test_Unauthorized_Reverts() public {
        vm.prank(alice);
        (uint256 tokenId,,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        // Bob tries to decrease Alice's position
        vm.expectRevert(OmniFiPositionManager.NotAuthorized.selector);
        vm.prank(bob);
        positionManager.decreaseLiquidity(
            IOmniFiPositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: 100,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1000
            })
        );
    }

    function test_Deadline_Reverts() public {
        vm.expectRevert(OmniFiPositionManager.TransactionTooOld.selector);
        vm.prank(alice);
        positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp - 1
            })
        );
    }

    function test_TokenURI_Success() public {
        vm.prank(alice);
        (uint256 tokenId,,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        string memory uri = positionManager.tokenURI(tokenId);
        assertGt(bytes(uri).length, 50);
        assertTrue(bytes(uri)[0] == 'd' && bytes(uri)[1] == 'a' && bytes(uri)[2] == 't');
    }

    function test_DecreaseLiquidity_InsufficientLiquidity_Reverts() public {
        vm.prank(alice);
        (uint256 tokenId, uint128 liquidity,,) = positionManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: address(token0),
                token1: address(token1),
                fee: 3000,
                tickLower: -60,
                tickUpper: 60,
                amount0Desired: 1 ether,
                amount1Desired: 1 ether,
                amount0Min: 0,
                amount1Min: 0,
                recipient: alice,
                deadline: block.timestamp + 1000
            })
        );

        vm.expectRevert(OmniFiPositionManager.InsufficientLiquidity.selector);
        vm.prank(alice);
        positionManager.decreaseLiquidity(
            IOmniFiPositionManager.DecreaseLiquidityParams({
                tokenId: tokenId,
                liquidity: liquidity + 1,
                amount0Min: 0,
                amount1Min: 0,
                deadline: block.timestamp + 1000
            })
        );
    }
}
