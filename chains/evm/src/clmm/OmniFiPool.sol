// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiPool } from "../interfaces/IOmniFiPool.sol";
import { IOmniFiPoolDeployer } from "../interfaces/IOmniFiPoolDeployer.sol";
import { IOmniFiMintCallback } from "../interfaces/IOmniFiMintCallback.sol";
import { IOmniFiSwapCallback } from "../interfaces/IOmniFiSwapCallback.sol";
import { IOmniFiPoolFactory } from "../interfaces/IOmniFiPoolFactory.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";

import { Tick } from "./libraries/Tick.sol";
import { TickBitmap } from "./libraries/TickBitmap.sol";
import { Position } from "./libraries/Position.sol";
import { SqrtPriceMath } from "./libraries/SqrtPriceMath.sol";
import { SwapMath } from "./libraries/SwapMath.sol";
import { TickMath } from "./libraries/TickMath.sol";
import { FullMath } from "./libraries/FullMath.sol";
import { FixedPoint128 } from "./libraries/FixedPoint128.sol";
import { LiquidityMath } from "./libraries/LiquidityMath.sol";
import { SafeCast } from "./libraries/SafeCast.sol";
import { TransferHelper } from "../v2/libraries/TransferHelper.sol";

/// @title OmniFi CLMM Core Pool
/// @notice Concentrated-liquidity AMM pool executing exact tick math, fee accumulation, and swaps
contract OmniFiPool is IOmniFiPool {
    using Tick for mapping(int24 => Tick.Info);
    using TickBitmap for mapping(int16 => uint256);
    using Position for mapping(bytes32 => Position.Info);
    using Position for Position.Info;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidSqrtPrice();
    error Locked();
    error NotFactory();
    error NotFeeRecipient();
    error InvalidTickSpacing();
    error ZeroLiquidity();
    error InsufficientToken0();
    error InsufficientToken1();
    error InvalidPriceLimit();
    error InvalidProtocolFeeFraction();

    address public immutable override factory;
    address public immutable override token0;
    address public immutable override token1;
    uint24 public immutable override fee;
    int24 public immutable override tickSpacing;
    uint128 public immutable override maxLiquidityPerTick;

    Slot0 public override slot0;
    uint256 public override feeGrowthGlobal0X128;
    uint256 public override feeGrowthGlobal1X128;
    ProtocolFees public override protocolFees;
    uint128 public override liquidity;

    mapping(int24 => Tick.Info) public override ticks;
    mapping(int16 => uint256) public override tickBitmap;
    mapping(bytes32 => Position.Info) public override positions;

    modifier lock() {
        if (!slot0.unlocked) revert Locked();
        slot0.unlocked = false;
        _;
        slot0.unlocked = true;
    }

    modifier onlyFactoryOwner() {
        if (msg.sender != factory && msg.sender != IOmniFiPoolFactory(factory).owner()) {
            revert NotFactory();
        }
        _;
    }

    constructor() {
        (factory, token0, token1, fee, tickSpacing) = IOmniFiPoolDeployer(msg.sender).parameters();
        maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(tickSpacing);
    }

    function balance0() private view returns (uint256) {
        return IERC20Minimal(token0).balanceOf(address(this));
    }

    function balance1() private view returns (uint256) {
        return IERC20Minimal(token1).balanceOf(address(this));
    }

    /// @inheritdoc IOmniFiPool
    function initialize(uint160 sqrtPriceX96) external override {
        if (slot0.sqrtPriceX96 != 0) revert AlreadyInitialized();
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE || sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidSqrtPrice();
        }

        int24 tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);
        uint8 defaultProtocolFeeFraction = IOmniFiPoolFactory(factory).defaultProtocolFeeFraction();

        slot0 = Slot0({
            sqrtPriceX96: sqrtPriceX96,
            tick: tick,
            protocolFeeFraction: defaultProtocolFeeFraction,
            unlocked: true
        });

        emit Initialize(sqrtPriceX96, tick);
    }

    struct ModifyPositionParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int128 liquidityDelta;
    }

    function _modifyPosition(ModifyPositionParams memory params)
        private
        returns (Position.Info storage position, int256 amount0, int256 amount1)
    {
        Tick.checkTicks(params.tickLower, params.tickUpper);
        if (params.tickLower % tickSpacing != 0 || params.tickUpper % tickSpacing != 0) {
            revert InvalidTickSpacing();
        }

        Slot0 memory _slot0 = slot0;
        position = positions.get(params.owner, params.tickLower, params.tickUpper);

        if (params.liquidityDelta != 0) {
            bool flippedLower = ticks.update(
                params.tickLower,
                _slot0.tick,
                params.liquidityDelta,
                feeGrowthGlobal0X128,
                feeGrowthGlobal1X128,
                false,
                maxLiquidityPerTick
            );
            bool flippedUpper = ticks.update(
                params.tickUpper,
                _slot0.tick,
                params.liquidityDelta,
                feeGrowthGlobal0X128,
                feeGrowthGlobal1X128,
                true,
                maxLiquidityPerTick
            );

            if (flippedLower) {
                tickBitmap.flipTick(params.tickLower, tickSpacing);
            }
            if (flippedUpper) {
                tickBitmap.flipTick(params.tickUpper, tickSpacing);
            }
        }

        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = ticks.getFeeGrowthInside(
            params.tickLower,
            params.tickUpper,
            _slot0.tick,
            feeGrowthGlobal0X128,
            feeGrowthGlobal1X128
        );

        position.update(params.liquidityDelta, feeGrowthInside0X128, feeGrowthInside1X128);

        if (params.liquidityDelta != 0) {
            if (_slot0.tick < params.tickLower) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            } else if (_slot0.tick < params.tickUpper) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    _slot0.sqrtPriceX96,
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    params.liquidityDelta
                );
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    _slot0.sqrtPriceX96,
                    params.liquidityDelta
                );
                liquidity = LiquidityMath.addDelta(liquidity, params.liquidityDelta);
            } else {
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    params.liquidityDelta
                );
            }
        }

        if (params.liquidityDelta < 0) {
            if (ticks[params.tickLower].liquidityGross == 0) ticks.clear(params.tickLower);
            if (ticks[params.tickUpper].liquidityGross == 0) ticks.clear(params.tickUpper);
        }
    }

    /// @inheritdoc IOmniFiPool
    function mint(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount,
        bytes calldata data
    ) external override lock returns (uint256 amount0, uint256 amount1) {
        if (amount == 0) revert ZeroLiquidity();

        (, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            ModifyPositionParams({
                owner: recipient,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: int128(amount)
            })
        );

        amount0 = uint256(amount0Int);
        amount1 = uint256(amount1Int);

        uint256 balance0Before = 0;
        uint256 balance1Before = 0;
        if (amount0 > 0) balance0Before = balance0();
        if (amount1 > 0) balance1Before = balance1();

        IOmniFiMintCallback(msg.sender).omniFiMintCallback(amount0, amount1, data);

        if (amount0 > 0 && balance0() < balance0Before + amount0) revert InsufficientToken0();
        if (amount1 > 0 && balance1() < balance1Before + amount1) revert InsufficientToken1();

        emit Mint(msg.sender, recipient, tickLower, tickUpper, amount, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPool
    function burn(int24 tickLower, int24 tickUpper, uint128 amount)
        external
        override
        lock
        returns (uint256 amount0, uint256 amount1)
    {
        if (amount == 0) revert ZeroLiquidity();

        (Position.Info storage position, int256 amount0Int, int256 amount1Int) = _modifyPosition(
            ModifyPositionParams({
                owner: msg.sender,
                tickLower: tickLower,
                tickUpper: tickUpper,
                liquidityDelta: -int128(amount)
            })
        );

        amount0 = uint256(-amount0Int);
        amount1 = uint256(-amount1Int);

        if (amount0 > 0 || amount1 > 0) {
            position.tokensOwed0 += uint128(amount0);
            position.tokensOwed1 += uint128(amount1);
        }

        emit Burn(msg.sender, tickLower, tickUpper, amount, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPool
    function collect(
        address recipient,
        int24 tickLower,
        int24 tickUpper,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external override lock returns (uint128 amount0, uint128 amount1) {
        Position.Info storage position = positions.get(msg.sender, tickLower, tickUpper);

        amount0 = amount0Requested > position.tokensOwed0 ? position.tokensOwed0 : amount0Requested;
        amount1 = amount1Requested > position.tokensOwed1 ? position.tokensOwed1 : amount1Requested;

        if (amount0 > 0) {
            position.tokensOwed0 -= amount0;
            TransferHelper.safeTransfer(token0, recipient, amount0);
        }
        if (amount1 > 0) {
            position.tokensOwed1 -= amount1;
            TransferHelper.safeTransfer(token1, recipient, amount1);
        }

        emit Collect(msg.sender, recipient, tickLower, tickUpper, amount0, amount1);
    }

    struct SwapState {
        int256 amountSpecifiedRemaining;
        int256 amountCalculated;
        uint160 sqrtPriceX96;
        int24 tick;
        uint256 feeGrowthGlobalX128;
        uint128 protocolFee;
        uint128 liquidity;
    }

    struct StepComputations {
        uint160 sqrtPriceStartX96;
        int24 tickNext;
        bool initialized;
        uint160 sqrtPriceNextX96;
        uint256 amountIn;
        uint256 amountOut;
        uint256 feeAmount;
    }

    /// @inheritdoc IOmniFiPool
    function swap(
        address recipient,
        bool zeroForOne,
        int256 amountSpecified,
        uint160 sqrtPriceLimitX96,
        bytes calldata data
    ) external override lock returns (int256 amount0, int256 amount1) {
        if (amountSpecified == 0) revert ZeroLiquidity();

        Slot0 memory _slot0 = slot0;
        if (_slot0.sqrtPriceX96 == 0) revert NotInitialized();

        if (zeroForOne) {
            if (
                sqrtPriceLimitX96 >= _slot0.sqrtPriceX96
                    || sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE
            ) {
                revert InvalidPriceLimit();
            }
        } else {
            if (
                sqrtPriceLimitX96 <= _slot0.sqrtPriceX96
                    || sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE
            ) {
                revert InvalidPriceLimit();
            }
        }

        bool exactInput = amountSpecified > 0;

        SwapState memory state = SwapState({
            amountSpecifiedRemaining: amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: _slot0.sqrtPriceX96,
            tick: _slot0.tick,
            feeGrowthGlobalX128: zeroForOne ? feeGrowthGlobal0X128 : feeGrowthGlobal1X128,
            protocolFee: 0,
            liquidity: liquidity
        });

        while (state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != sqrtPriceLimitX96) {
            StepComputations memory step;
            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) =
                tickBitmap.nextInitializedTickWithinOneWord(state.tick, tickSpacing, zeroForOne);

            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            step.sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(step.tickNext);

            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) =
                SwapMath.computeSwapStep(
                    state.sqrtPriceX96,
                    (zeroForOne
                            ? step.sqrtPriceNextX96 < sqrtPriceLimitX96
                            : step.sqrtPriceNextX96 > sqrtPriceLimitX96)
                        ? sqrtPriceLimitX96
                        : step.sqrtPriceNextX96,
                    state.liquidity,
                    state.amountSpecifiedRemaining,
                    fee
                );

            if (exactInput) {
                unchecked {
                    state.amountSpecifiedRemaining -= int256(step.amountIn + step.feeAmount);
                    state.amountCalculated -= int256(step.amountOut);
                }
            } else {
                unchecked {
                    state.amountSpecifiedRemaining += int256(step.amountOut);
                    state.amountCalculated += int256(step.amountIn + step.feeAmount);
                }
            }

            // Fee growth accounting & protocol fee
            if (_slot0.protocolFeeFraction > 0) {
                uint256 deltaProtocolFee = (step.feeAmount * _slot0.protocolFeeFraction) / 4;
                step.feeAmount -= deltaProtocolFee;
                state.protocolFee += SafeCast.toUint128(deltaProtocolFee);
            }

            if (state.liquidity > 0) {
                state.feeGrowthGlobalX128 += FullMath.mulDiv(
                    step.feeAmount, FixedPoint128.Q128, state.liquidity
                );
            }

            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                if (step.initialized) {
                    int128 liquidityNet = ticks.cross(
                        step.tickNext,
                        zeroForOne ? state.feeGrowthGlobalX128 : feeGrowthGlobal0X128,
                        zeroForOne ? feeGrowthGlobal1X128 : state.feeGrowthGlobalX128
                    );
                    if (zeroForOne) liquidityNet = -liquidityNet;
                    state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
                }
                state.tick = zeroForOne ? step.tickNext - 1 : step.tickNext;
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                state.tick = TickMath.getTickAtSqrtPrice(state.sqrtPriceX96);
            }
        }

        // Update pool state
        if (state.tick != _slot0.tick) {
            (slot0.sqrtPriceX96, slot0.tick) = (state.sqrtPriceX96, state.tick);
        } else {
            slot0.sqrtPriceX96 = state.sqrtPriceX96;
        }

        if (liquidity != state.liquidity) liquidity = state.liquidity;

        if (zeroForOne) {
            feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees.token0 += state.protocolFee;
        } else {
            feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) protocolFees.token1 += state.protocolFee;
        }

        (amount0, amount1) = zeroForOne == exactInput
            ? (amountSpecified - state.amountSpecifiedRemaining, state.amountCalculated)
            : (state.amountCalculated, amountSpecified - state.amountSpecifiedRemaining);

        // Execute token transfers & callbacks
        if (zeroForOne) {
            if (amount1 < 0) TransferHelper.safeTransfer(token1, recipient, uint256(-amount1));

            uint256 balance0Before = balance0();
            IOmniFiSwapCallback(msg.sender).omniFiSwapCallback(amount0, amount1, data);
            if (balance0() < balance0Before + uint256(amount0)) revert InsufficientToken0();
        } else {
            if (amount0 < 0) TransferHelper.safeTransfer(token0, recipient, uint256(-amount0));

            uint256 balance1Before = balance1();
            IOmniFiSwapCallback(msg.sender).omniFiSwapCallback(amount0, amount1, data);
            if (balance1() < balance1Before + uint256(amount1)) revert InsufficientToken1();
        }

        emit Swap(
            msg.sender, recipient, amount0, amount1, state.sqrtPriceX96, state.liquidity, state.tick
        );
    }

    /// @inheritdoc IOmniFiPool
    function setProtocolFeeFraction(uint8 newFraction) external override onlyFactoryOwner {
        if (newFraction > 4) revert InvalidProtocolFeeFraction();
        uint8 oldFraction = slot0.protocolFeeFraction;
        slot0.protocolFeeFraction = newFraction;
        emit SetProtocolFeeFraction(oldFraction, newFraction);
    }

    /// @inheritdoc IOmniFiPool
    function collectProtocolFees(
        address recipient,
        uint128 amount0Requested,
        uint128 amount1Requested
    ) external override returns (uint128 amount0, uint128 amount1) {
        address feeRecipient = IOmniFiPoolFactory(factory).feeRecipient();
        address owner = IOmniFiPoolFactory(factory).owner();
        if (msg.sender != feeRecipient && msg.sender != owner) revert NotFeeRecipient();

        amount0 = amount0Requested > protocolFees.token0 ? protocolFees.token0 : amount0Requested;
        amount1 = amount1Requested > protocolFees.token1 ? protocolFees.token1 : amount1Requested;

        if (amount0 > 0) {
            protocolFees.token0 -= amount0;
            TransferHelper.safeTransfer(token0, recipient, amount0);
        }
        if (amount1 > 0) {
            protocolFees.token1 -= amount1;
            TransferHelper.safeTransfer(token1, recipient, amount1);
        }

        emit CollectProtocolFees(recipient, amount0, amount1);
    }
}
