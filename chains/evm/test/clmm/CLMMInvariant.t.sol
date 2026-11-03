// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiPoolFactory } from "../../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPool } from "../../src/clmm/OmniFiPool.sol";
import { IOmniFiPool } from "../../src/interfaces/IOmniFiPool.sol";
import { IOmniFiMintCallback } from "../../src/interfaces/IOmniFiMintCallback.sol";
import { IOmniFiSwapCallback } from "../../src/interfaces/IOmniFiSwapCallback.sol";
import { TickMath } from "../../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract CLMMHandler is Test, IOmniFiMintCallback, IOmniFiSwapCallback {
    IOmniFiPool public pool;
    MockERC20 public token0;
    MockERC20 public token1;

    uint256 public prevFeeGrowth0;
    uint256 public prevFeeGrowth1;

    uint256 public totalMintedLiquidity;
    uint256 public totalBurnedLiquidity;

    constructor(address _pool, address _token0, address _token1) {
        pool = IOmniFiPool(_pool);
        token0 = MockERC20(_token0);
        token1 = MockERC20(_token1);

        token0.mint(address(this), 1_000_000 ether);
        token1.mint(address(this), 1_000_000 ether);

        prevFeeGrowth0 = pool.feeGrowthGlobal0X128();
        prevFeeGrowth1 = pool.feeGrowthGlobal1X128();
    }

    function omniFiMintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata)
        external
        override
    {
        require(msg.sender == address(pool), "Unauthorized callback");
        if (amount0Owed > 0) token0.transfer(msg.sender, amount0Owed);
        if (amount1Owed > 0) token1.transfer(msg.sender, amount1Owed);
    }

    function omniFiSwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata)
        external
        override
    {
        require(msg.sender == address(pool), "Unauthorized callback");
        if (amount0Delta > 0) token0.transfer(msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) token1.transfer(msg.sender, uint256(amount1Delta));
    }

    function swap0For1(uint256 amountInRaw) public {
        uint256 amountIn = bound(amountInRaw, 1000, 1 ether);
        prevFeeGrowth0 = pool.feeGrowthGlobal0X128();
        prevFeeGrowth1 = pool.feeGrowthGlobal1X128();

        try pool.swap(
            address(this),
            true, // zeroForOne
            int256(amountIn),
            TickMath.MIN_SQRT_PRICE + 1,
            ""
        ) { }
            catch { }
    }

    function swap1For0(uint256 amountInRaw) public {
        uint256 amountIn = bound(amountInRaw, 1000, 1 ether);
        prevFeeGrowth0 = pool.feeGrowthGlobal0X128();
        prevFeeGrowth1 = pool.feeGrowthGlobal1X128();

        try pool.swap(
            address(this),
            false, // oneForZero
            int256(amountIn),
            TickMath.MAX_SQRT_PRICE - 1,
            ""
        ) { }
            catch { }
    }

    function mint(uint256 rangeIdx, uint128 amountRaw) public {
        int24[3] memory lowers = [int24(-60), -120, -180];
        int24[3] memory uppers = [int24(60), 120, 180];

        uint256 idx = rangeIdx % 3;
        int24 tickLower = lowers[idx];
        int24 tickUpper = uppers[idx];

        uint128 liquidity = uint128(bound(amountRaw, 10_000, 10 ether));

        try pool.mint(address(this), tickLower, tickUpper, liquidity, "") {
            totalMintedLiquidity += liquidity;
        } catch { }
    }

    function burn(uint256 rangeIdx, uint128 amountRaw) public {
        int24[3] memory lowers = [int24(-60), -120, -180];
        int24[3] memory uppers = [int24(60), 120, 180];

        uint256 idx = rangeIdx % 3;
        int24 tickLower = lowers[idx];
        int24 tickUpper = uppers[idx];

        uint128 burnAmount = uint128(bound(amountRaw, 1000, 1 ether));

        try pool.burn(tickLower, tickUpper, burnAmount) {
            totalBurnedLiquidity += burnAmount;
            pool.collect(address(this), tickLower, tickUpper, type(uint128).max, type(uint128).max);
        } catch { }
    }
}

contract CLMMInvariantTest is Test {
    OmniFiPoolFactory internal factory;
    IOmniFiPool internal pool;
    MockERC20 internal token0;
    MockERC20 internal token1;
    CLMMHandler internal handler;

    function setUp() public {
        factory = new OmniFiPoolFactory(address(this), address(0xBB));

        MockERC20 tA = new MockERC20("Token A", "TKA", 18);
        MockERC20 tB = new MockERC20("Token B", "TKB", 18);

        address[2] memory tokens = [address(tA), address(tB)];
        if (tokens[0] > tokens[1]) {
            address temp = tokens[0];
            tokens[0] = tokens[1];
            tokens[1] = temp;
        }

        token0 = MockERC20(tokens[0]);
        token1 = MockERC20(tokens[1]);

        address poolAddress = factory.createPool(address(token0), address(token1), 3000);
        pool = IOmniFiPool(poolAddress);
        pool.initialize(TickMath.getSqrtPriceAtTick(0));

        handler = new CLMMHandler(poolAddress, address(token0), address(token1));

        // Initial liquidity
        handler.mint(0, 100 ether);

        targetContract(address(handler));

        bytes4[] memory selectors = new bytes4[](4);
        selectors[0] = CLMMHandler.swap0For1.selector;
        selectors[1] = CLMMHandler.swap1For0.selector;
        selectors[2] = CLMMHandler.mint.selector;
        selectors[3] = CLMMHandler.burn.selector;
        targetSelector(FuzzSelector({ addr: address(handler), selectors: selectors }));
    }

    /// @notice Invariant 1: Global fee growth is monotonically non-decreasing
    function invariant_feeGrowthMonotonic() public view {
        uint256 fg0 = pool.feeGrowthGlobal0X128();
        uint256 fg1 = pool.feeGrowthGlobal1X128();
        assertGe(fg0, handler.prevFeeGrowth0(), "feeGrowthGlobal0 must not decrease");
        assertGe(fg1, handler.prevFeeGrowth1(), "feeGrowthGlobal1 must not decrease");
    }

    /// @notice Invariant 2: Current price and tick are always within valid bounds
    function invariant_tickAndPriceWithinBounds() public view {
        (uint160 sqrtPriceX96, int24 tick,,) = pool.slot0();
        assertGe(sqrtPriceX96, TickMath.MIN_SQRT_PRICE, "sqrtPrice below MIN");
        assertLe(sqrtPriceX96, TickMath.MAX_SQRT_PRICE, "sqrtPrice above MAX");
        assertGe(tick, TickMath.MIN_TICK, "tick below MIN");
        assertLe(tick, TickMath.MAX_TICK, "tick above MAX");
    }

    /// @notice Invariant 3: Pool balances are sufficient to cover protocol fees
    function invariant_protocolFeesCovered() public view {
        (uint128 protoFee0, uint128 protoFee1) = pool.protocolFees();
        assertGe(token0.balanceOf(address(pool)), protoFee0, "Token0 balance below protocol fee");
        assertGe(token1.balanceOf(address(pool)), protoFee1, "Token1 balance below protocol fee");
    }
}
