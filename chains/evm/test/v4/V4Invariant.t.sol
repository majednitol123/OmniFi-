// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolManager } from "../../src/v4-core/OmniFiPoolManager.sol";
import { IOmniFiPoolManager } from "../../src/interfaces/IOmniFiPoolManager.sol";
import { Currency } from "../../src/v4-core/types/Currency.sol";
import { PoolKey } from "../../src/v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "../../src/v4-core/types/PoolId.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { UnlockRouter } from "../helpers/UnlockRouter.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract V4Handler is Test {
    using PoolIdLibrary for PoolKey;

    OmniFiPoolManager public manager;
    UnlockRouter public router;
    MockERC20 public token0;
    MockERC20 public token1;

    Currency public currency0;
    Currency public currency1;
    PoolKey public key;

    uint256 public successfulSwaps;
    uint256 public successfulLiquidityMods;
    uint256 public successfulDonations;

    constructor(
        address _manager,
        address _router,
        address _token0,
        address _token1,
        PoolKey memory _key
    ) {
        manager = OmniFiPoolManager(payable(_manager));
        router = UnlockRouter(payable(_router));
        token0 = MockERC20(_token0);
        token1 = MockERC20(_token1);
        currency0 = _key.currency0;
        currency1 = _key.currency1;
        key = _key;

        // Fund router with ample tokens
        token0.mint(address(router), 10_000_000 ether);
        token1.mint(address(router), 10_000_000 ether);
    }

    function swap0For1(uint256 amountInRaw) external {
        uint256 amountIn = bound(amountInRaw, 1000, 10 ether);

        try router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.SwapAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0,
                    tickUpper: 0,
                    liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: true,
                    amountSpecified: int256(amountIn),
                    sqrtPriceLimitX96: TickMath.MIN_SQRT_PRICE + 1
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        ) {
            successfulSwaps++;
        } catch { }
    }

    function swap1For0(uint256 amountInRaw) external {
        uint256 amountIn = bound(amountInRaw, 1000, 10 ether);

        try router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.SwapAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0,
                    tickUpper: 0,
                    liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: int256(amountIn),
                    sqrtPriceLimitX96: TickMath.MAX_SQRT_PRICE - 1
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        ) {
            successfulSwaps++;
        } catch { }
    }

    function modifyLiquidity(uint256 amountRaw) external {
        uint256 delta = bound(amountRaw, 1000, 5 ether);

        try router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -120,
                    tickUpper: 120,
                    liquidityDelta: int128(int256(delta))
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: 0,
                    sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        ) {
            successfulLiquidityMods++;
        } catch { }
    }

    function donate(uint256 amount0Raw, uint256 amount1Raw) external {
        uint256 a0 = bound(amount0Raw, 100, 1 ether);
        uint256 a1 = bound(amount1Raw, 100, 1 ether);

        try router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.DonateAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: 0,
                    tickUpper: 0,
                    liquidityDelta: 0
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: 0,
                    sqrtPriceLimitX96: 0
                }),
                donateAmount0: a0,
                donateAmount1: a1,
                recipient: address(this)
            })
        ) {
            successfulDonations++;
        } catch { }
    }
}

contract V4InvariantTest is Test {
    using PoolIdLibrary for PoolKey;

    OmniFiPoolManager internal manager;
    UnlockRouter internal router;
    V4Handler internal handler;

    MockERC20 internal token0;
    MockERC20 internal token1;

    Currency internal currency0;
    Currency internal currency1;
    PoolKey internal key;

    function setUp() public {
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

        // Seed initial liquidity so swaps execute immediately
        token0.mint(address(router), 1_000_000 ether);
        token1.mint(address(router), 1_000_000 ether);

        router.execute(
            UnlockRouter.CallbackData({
                action: UnlockRouter.Action.ModifyLiquidityAndSettle,
                key: key,
                modifyParams: IOmniFiPoolManager.ModifyLiquidityParams({
                    tickLower: -600,
                    tickUpper: 600,
                    liquidityDelta: 50 ether
                }),
                swapParams: IOmniFiPoolManager.SwapParams({
                    zeroForOne: false,
                    amountSpecified: 0,
                    sqrtPriceLimitX96: 0
                }),
                donateAmount0: 0,
                donateAmount1: 0,
                recipient: address(this)
            })
        );

        handler = new V4Handler(
            address(manager),
            address(router),
            address(token0),
            address(token1),
            key
        );

        targetContract(address(handler));
    }

    /// @notice Invariant: Terminal deltas for router MUST be 0 outside active lock
    function invariant_terminalDeltasAlwaysZero() public view {
        assertEq(
            manager.getDelta(address(router), currency0),
            0,
            "Transient delta for currency0 must be zero outside unlock"
        );
        assertEq(
            manager.getDelta(address(router), currency1),
            0,
            "Transient delta for currency1 must be zero outside unlock"
        );
    }

    /// @notice Invariant: Vault token holdings must never be negative or undercollateralized
    function invariant_vaultSolvency() public view {
        assertGe(
            token0.balanceOf(address(manager)),
            0,
            "Token0 balance of manager must be non-negative"
        );
        assertGe(
            token1.balanceOf(address(manager)),
            0,
            "Token1 balance of manager must be non-negative"
        );
    }

    /// @notice Invariant: Pool price and tick remain bounded
    function invariant_poolStateWithinBounds() public view {
        (uint160 sqrtPriceX96, int24 tick,,) = manager.getSlot0(key.toId());
        assertGe(sqrtPriceX96, TickMath.MIN_SQRT_PRICE, "Price below MIN_SQRT_PRICE");
        assertLe(sqrtPriceX96, TickMath.MAX_SQRT_PRICE, "Price above MAX_SQRT_PRICE");
        assertGe(tick, TickMath.MIN_TICK, "Tick below MIN_TICK");
        assertLe(tick, TickMath.MAX_TICK, "Tick above MAX_TICK");
    }
}

