// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolManager } from "../../src/v4-core/OmniFiPoolManager.sol";
import { IOmniFiPoolManager } from "../../src/interfaces/IOmniFiPoolManager.sol";
import { Currency } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "../../src/v4-core/types/PoolId.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "../../src/v4-core/types/BalanceDelta.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { UnlockRouter } from "../helpers/UnlockRouter.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";

contract PoolOperationsTest is Test {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;

    OmniFiPoolManager manager;
    UnlockRouter router;

    MockERC20 token0;
    MockERC20 token1;

    Currency currency0;
    Currency currency1;
    PoolKey key;

    // Reference isolated CLMM pool for differential check
    OmniFiPoolFactory clmmFactory;
    IOmniFiPool clmmPool;

    function setUp() external {
        manager = new OmniFiPoolManager(address(this), address(this));
        router = new UnlockRouter(address(manager));

        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address addrA = address(tokenA);
        address addrB = address(tokenB);

        if (addrA < addrB) {
            token0 = tokenA;
            token1 = tokenB;
        } else {
            token0 = tokenB;
            token1 = tokenA;
        }

        currency0 = Currency.wrap(address(token0));
        currency1 = Currency.wrap(address(token1));

        key = PoolKey({
            currency0: currency0,
            currency1: currency1,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        manager.initialize(key, TickMath.getSqrtPriceAtTick(0));

        // Deploy reference CLMM pool
        clmmFactory = new OmniFiPoolFactory(address(this), address(this));
        address clmmPoolAddr = clmmFactory.createPool(address(token0), address(token1), 3000);
        clmmPool = IOmniFiPool(clmmPoolAddr);
        clmmPool.initialize(TickMath.getSqrtPriceAtTick(0));

        // Fund router and test contract
        token0.mint(address(router), 10_000_000 ether);
        token1.mint(address(router), 10_000_000 ether);
        token0.mint(address(this), 10_000_000 ether);
        token1.mint(address(this), 10_000_000 ether);
    }

    function test_modifyLiquidity_success() external {
        bytes memory result = router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -120, tickUpper: 120, liquidityDelta: 100 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        assertTrue(delta.amount0() > 0);
        assertTrue(delta.amount1() > 0);
        assertEq(manager.getLiquidity(key.toId()), 100 ether);
    }

    function test_swap_exactInput_zeroForOne() external {
        // 1. Add liquidity
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -600, tickUpper: 600, liquidityDelta: 1000 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        uint256 routerToken1Before = token1.balanceOf(address(router));

        // 2. Execute exact input swap (10 ether token0 in)
        bytes memory result = router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.SwapAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: true,
                    amountSpecified: 10 ether,
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(router)
            })
        );

        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        assertEq(delta.amount0(), 10 ether);
        assertTrue(delta.amount1() < 0); // Negative indicates token1 out

        uint256 routerToken1After = token1.balanceOf(address(router));
        assertEq(routerToken1After - routerToken1Before, uint256(uint128(-delta.amount1())));
    }

    function test_swap_exactInput_oneForZero() external {
        // 1. Add liquidity
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -600, tickUpper: 600, liquidityDelta: 1000 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        uint256 routerToken0Before = token0.balanceOf(address(router));

        // 2. Execute exact input swap (10 ether token1 in)
        bytes memory result = router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.SwapAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: 10 ether,
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(router)
            })
        );

        BalanceDelta delta = abi.decode(result, (BalanceDelta));

        assertEq(delta.amount1(), 10 ether);
        assertTrue(delta.amount0() < 0); // Negative indicates token0 out

        uint256 routerToken0After = token0.balanceOf(address(router));
        assertEq(routerToken0After - routerToken0Before, uint256(uint128(-delta.amount0())));
    }

    function test_donate_success() external {
        // Add liquidity first
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -60, tickUpper: 60, liquidityDelta: 100 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        (uint256 fg0Before, uint256 fg1Before) = manager.getFeeGrowthGlobals(key.toId());

        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.DonateAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 1 ether,
                donateAmount1: 2 ether,
                recipient: address(this)
            })
        );

        (uint256 fg0After, uint256 fg1After) = manager.getFeeGrowthGlobals(key.toId());

        assertTrue(fg0After > fg0Before);
        assertTrue(fg1After > fg1Before);
    }
}
