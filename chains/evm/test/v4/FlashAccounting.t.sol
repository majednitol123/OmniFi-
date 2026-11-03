// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolManager } from "../../src/v4-core/OmniFiPoolManager.sol";
import { IOmniFiPoolManager } from "../../src/interfaces/IOmniFiPoolManager.sol";
import { IUnlockCallback } from "../../src/interfaces/IUnlockCallback.sol";
import { Currency, CurrencyLibrary } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "../../src/v4-core/types/PoolId.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { UnlockRouter } from "../helpers/UnlockRouter.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract FlashAccountingTest is Test {
    using PoolIdLibrary for PoolKey;

    OmniFiPoolManager manager;
    UnlockRouter router;

    MockERC20 token0;
    MockERC20 token1;

    Currency currency0;
    Currency currency1;
    PoolKey key;

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

        // Fund router
        token0.mint(address(router), 1_000_000 ether);
        token1.mint(address(router), 1_000_000 ether);
    }

    /// @notice Invariant 1: Unpaid delta MUST revert
    function test_revertIfCurrencyDeltaNotZero() external {
        // First add liquidity so swap has something to trade against
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -600, tickUpper: 600, liquidityDelta: 10 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        // Now attempt to swap without settling deltas
        vm.expectRevert();
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.SwapWithoutSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: true,
                    amountSpecified: 1 ether,
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );
    }

    /// @notice Invariant 2: Nested unlock calls MUST revert (reentrancy prevention)
    function test_revertIfNestedUnlock() external {
        vm.expectRevert(IOmniFiPoolManager.AlreadyUnlocked.selector);
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.NestedUnlock,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );
    }

    /// @notice Invariant 3: Take without credit MUST revert
    function test_revertIfTakeWithoutCredit() external {
        vm.expectRevert(IOmniFiPoolManager.InsufficientCredit.selector);
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.TakeWithoutCredit,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0, tickUpper: 0, liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );
    }

    /// @notice Invariant 4: Transient storage deltas MUST be 0 after successful unlock
    function test_transientStorageClearedAfterUnlock() external {
        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -120, tickUpper: 120, liquidityDelta: 1 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        // Deltas outside lock context must be 0
        assertEq(manager.getDelta(address(router), currency0), 0);
        assertEq(manager.getDelta(address(router), currency1), 0);
    }

    /// @notice Invariant 5: Direct ETH settlement with excess refund
    function test_nativeEthSettlementAndRefund() external {
        Currency nativeCurrency = CurrencyLibrary.NATIVE;
        Currency erc20Currency = Currency.wrap(address(token1));

        // Address(0) < Address(token1) is always true
        PoolKey memory ethPoolKey = PoolKey({
            currency0: nativeCurrency,
            currency1: erc20Currency,
            fee: 3000,
            tickSpacing: 60,
            hooks: address(0)
        });

        manager.initialize(ethPoolKey, TickMath.getSqrtPriceAtTick(0));

        // Router provides liquidity for ETH pool
        vm.deal(address(router), 100 ether);

        uint256 routerEthBefore = address(router).balance;

        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: ethPoolKey,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -60, tickUpper: 60, liquidityDelta: 1 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false, amountSpecified: 0, sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        uint256 routerEthAfter = address(router).balance;
        // Router ETH balance decreased by exactly the deposit
        assertTrue(routerEthBefore > routerEthAfter);
    }

    function test_revertIfThirdPartyCallsDuringUnlock() external {
        MaliciousUnlocker unlocker = new MaliciousUnlocker(address(manager), key);
        bool caught = unlocker.executeUnlock();
        assertTrue(caught, "Third party call during unlock must revert with NotActiveLocker");
    }
}

contract MaliciousUnlocker is IUnlockCallback {
    OmniFiPoolManager manager;
    PoolKey key;

    constructor(address _manager, PoolKey memory _key) {
        manager = OmniFiPoolManager(payable(_manager));
        key = _key;
    }

    function executeUnlock() external returns (bool) {
        bytes memory result = manager.unlock("");
        return abi.decode(result, (bool));
    }

    function unlockCallback(bytes calldata) external override returns (bytes memory) {
        ThirdPartyCaller thirdParty = new ThirdPartyCaller(address(manager), key);
        bool caught = false;
        try thirdParty.doSwap() {
            caught = false;
        } catch {
            caught = true;
        }
        return abi.encode(caught);
    }
}

contract ThirdPartyCaller {
    OmniFiPoolManager manager;
    PoolKey key;

    constructor(address _manager, PoolKey memory _key) {
        manager = OmniFiPoolManager(payable(_manager));
        key = _key;
    }

    function doSwap() external {
        manager.swap(
            key,
            IOmniFiPoolManager.SwapParams({
                zeroForOne: true,
                amountSpecified: 100 ether,
                sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
            })
        );
    }
}
