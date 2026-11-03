// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";
import { CLMMTestHelper } from "../helpers/CLMMTestHelper.sol";

contract OmniFiPoolTest is Test {
    OmniFiPoolFactory internal factory;
    OmniFiPool internal pool;
    MockERC20 internal token0;
    MockERC20 internal token1;
    CLMMTestHelper internal helper;

    address internal owner = address(0xAA);
    address internal feeRecipient = address(0xBB);
    address internal user = address(0x111);

    uint160 internal constant SQRT_RATIO_1_1 = 79_228_162_514_264_337_593_543_950_336;

    function setUp() public {
        factory = new OmniFiPoolFactory(owner, feeRecipient);
        MockERC20 tA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tB = new MockERC20("Token B", "TKNB", 18);

        // Ensure token0 < token1
        if (address(tA) < address(tB)) {
            token0 = tA;
            token1 = tB;
        } else {
            token0 = tB;
            token1 = tA;
        }

        address poolAddr = factory.createPool(address(token0), address(token1), 3000);
        pool = OmniFiPool(poolAddr);

        helper = new CLMMTestHelper(address(token0), address(token1));

        // Fund helper
        token0.mint(address(helper), 1000 ether);
        token1.mint(address(helper), 1000 ether);

        // Fund user
        token0.mint(user, 1000 ether);
        token1.mint(user, 1000 ether);
    }

    function test_Initialize() public {
        pool.initialize(SQRT_RATIO_1_1);

        (uint160 sp, int24 tick, uint8 protoFee, bool unlocked) = pool.slot0();
        assertEq(sp, SQRT_RATIO_1_1);
        assertEq(tick, 0);
        assertEq(protoFee, 0);
        assertTrue(unlocked);

        // Cannot initialize twice
        vm.expectRevert(OmniFiPool.AlreadyInitialized.selector);
        pool.initialize(SQRT_RATIO_1_1);
    }

    function test_Mint_InRange() public {
        pool.initialize(SQRT_RATIO_1_1);

        // Mint liquidity around tick 0: [-60, 60]
        vm.prank(address(helper));
        (uint256 amount0, uint256 amount1) = pool.mint(address(helper), -60, 60, 1 ether, "");

        assertTrue(amount0 > 0);
        assertTrue(amount1 > 0);
        assertEq(pool.liquidity(), 1 ether);

        (uint128 gross, int128 net,,, bool init) = pool.ticks(-60);
        assertTrue(init);
        assertEq(gross, 1 ether);
        assertEq(net, 1 ether);

        (gross, net,,, init) = pool.ticks(60);
        assertTrue(init);
        assertEq(gross, 1 ether);
        assertEq(net, -1 ether);
    }

    function test_Swap_ExactInput_ZeroForOne() public {
        pool.initialize(SQRT_RATIO_1_1);

        // Mint liquidity
        vm.prank(address(helper));
        pool.mint(address(helper), -60, 60, 100 ether, "");

        // Swap 0.1 ether token0 for token1
        uint256 balance1Before = token1.balanceOf(user);
        vm.prank(address(helper));
        (int256 a0, int256 a1) =
            pool.swap(
                user,
                true,
                0.1 ether,
                SQRT_RATIO_1_1 / 2, // slippage limit
                ""
            );

        assertEq(a0, 0.1 ether);
        assertTrue(a1 < 0); // Output token1
        assertEq(token1.balanceOf(user) - balance1Before, uint256(-a1));

        (uint160 spNext, int24 tickNext,,) = pool.slot0();
        assertTrue(spNext < SQRT_RATIO_1_1);
        assertTrue(tickNext <= 0);
    }

    function test_Swap_ExactInput_OneForZero() public {
        pool.initialize(SQRT_RATIO_1_1);

        // Mint liquidity
        vm.prank(address(helper));
        pool.mint(address(helper), -60, 60, 100 ether, "");

        // Swap 0.1 ether token1 for token0
        uint256 balance0Before = token0.balanceOf(user);
        vm.prank(address(helper));
        (int256 a0, int256 a1) =
            pool.swap(
                user,
                false,
                0.1 ether,
                SQRT_RATIO_1_1 * 2, // slippage limit
                ""
            );

        assertEq(a1, 0.1 ether);
        assertTrue(a0 < 0); // Output token0
        assertEq(token0.balanceOf(user) - balance0Before, uint256(-a0));

        (uint160 spNext, int24 tickNext,,) = pool.slot0();
        assertTrue(spNext > SQRT_RATIO_1_1);
        assertTrue(tickNext >= 0);
    }

    function test_Burn_And_Collect() public {
        pool.initialize(SQRT_RATIO_1_1);

        vm.prank(address(helper));
        (uint256 a0Mint, uint256 a1Mint) = pool.mint(address(helper), -60, 60, 10 ether, "");

        // Burn half
        vm.prank(address(helper));
        (uint256 a0Burn, uint256 a1Burn) = pool.burn(-60, 60, 5 ether);

        assertApproxEqAbs(a0Burn, a0Mint / 2, 1);
        assertApproxEqAbs(a1Burn, a1Mint / 2, 1);
        assertEq(pool.liquidity(), 5 ether);

        // Collect burned tokens
        uint256 b0Before = token0.balanceOf(address(helper));
        uint256 b1Before = token1.balanceOf(address(helper));

        vm.prank(address(helper));
        (uint128 c0, uint128 c1) =
            pool.collect(address(helper), -60, 60, type(uint128).max, type(uint128).max);

        assertEq(c0, a0Burn);
        assertEq(c1, a1Burn);
        assertEq(token0.balanceOf(address(helper)) - b0Before, c0);
        assertEq(token1.balanceOf(address(helper)) - b1Before, c1);
    }

    function test_ProtocolFee_Accumulation_And_Collection() public {
        pool.initialize(SQRT_RATIO_1_1);

        // Enable protocol fee: 1 (25% of pool fee)
        vm.prank(owner);
        factory.setPoolProtocolFeeFraction(address(pool), 1);

        vm.prank(address(helper));
        pool.mint(address(helper), -60, 60, 100 ether, "");

        // Swap 0.1 ether token0
        vm.prank(address(helper));
        pool.swap(user, true, 0.1 ether, SQRT_RATIO_1_1 / 2, "");

        (uint128 pFee0, uint128 pFee1) = pool.protocolFees();
        assertTrue(pFee0 > 0);
        assertEq(pFee1, 0);

        // Collect protocol fee
        uint256 b0Before = token0.balanceOf(feeRecipient);
        vm.prank(feeRecipient);
        pool.collectProtocolFees(feeRecipient, pFee0, 0);

        assertEq(token0.balanceOf(feeRecipient) - b0Before, pFee0);
    }
}
