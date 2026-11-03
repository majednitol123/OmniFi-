// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Tick } from "../../clmm/libraries/Tick.sol";
import { TickBitmap } from "../../clmm/libraries/TickBitmap.sol";
import { Position } from "../../clmm/libraries/Position.sol";
import { SqrtPriceMath } from "../../clmm/libraries/SqrtPriceMath.sol";
import { SwapMath } from "../../clmm/libraries/SwapMath.sol";
import { TickMath } from "../../clmm/libraries/TickMath.sol";
import { FullMath } from "../../clmm/libraries/FullMath.sol";
import { FixedPoint128 } from "../../clmm/libraries/FixedPoint128.sol";
import { LiquidityMath } from "../../clmm/libraries/LiquidityMath.sol";
import { SafeCast } from "../../clmm/libraries/SafeCast.sol";

import { BalanceDelta, BalanceDeltaLibrary } from "../types/BalanceDelta.sol";

/// @title Pool Library
/// @notice Implements concentrated-liquidity state transitions and math for the singleton pool manager
library Pool {
    using Tick for mapping(int24 => Tick.Info);
    using TickBitmap for mapping(int16 => uint256);
    using Position for mapping(bytes32 => Position.Info);
    using Position for Position.Info;
    using SafeCast for int256;
    using SafeCast for uint256;

    error AlreadyInitialized();
    error NotInitialized();
    error InvalidSqrtPrice();
    error InvalidTickSpacing();
    error ZeroLiquidity();
    error InvalidPriceLimit();

    struct Slot0 {
        uint160 sqrtPriceX96;
        int24 tick;
        uint24 protocolFee;
        bool isPaused;
    }

    struct State {
        Slot0 slot0;
        uint256 feeGrowthGlobal0X128;
        uint256 feeGrowthGlobal1X128;
        uint128 liquidity;
        mapping(int24 => Tick.Info) ticks;
        mapping(int16 => uint256) tickBitmap;
        mapping(bytes32 => Position.Info) positions;
        uint256 protocolFees0;
        uint256 protocolFees1;
    }

    struct ModifyPositionParams {
        address owner;
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
        int24 tickSpacing;
    }

    function initialize(State storage self, uint160 sqrtPriceX96, uint24 protocolFee)
        internal
        returns (int24 tick)
    {
        if (self.slot0.sqrtPriceX96 != 0) revert AlreadyInitialized();
        if (sqrtPriceX96 < TickMath.MIN_SQRT_PRICE || sqrtPriceX96 >= TickMath.MAX_SQRT_PRICE) {
            revert InvalidSqrtPrice();
        }

        tick = TickMath.getTickAtSqrtPrice(sqrtPriceX96);

        self.slot0 = Slot0({
            sqrtPriceX96: sqrtPriceX96, tick: tick, protocolFee: protocolFee, isPaused: false
        });
    }

    function modifyLiquidity(State storage self, ModifyPositionParams memory params)
        internal
        returns (BalanceDelta delta)
    {
        Tick.checkTicks(params.tickLower, params.tickUpper);
        if (
            params.tickLower % params.tickSpacing != 0 || params.tickUpper % params.tickSpacing != 0
        ) {
            revert InvalidTickSpacing();
        }

        Slot0 memory _slot0 = self.slot0;
        if (_slot0.sqrtPriceX96 == 0) revert NotInitialized();

        uint128 maxLiquidityPerTick = Tick.tickSpacingToMaxLiquidityPerTick(params.tickSpacing);

        int128 liquidityDelta128 = SafeCast.toInt128(params.liquidityDelta);

        // Update lower tick
        bool flippedLower;
        if (liquidityDelta128 != 0) {
            flippedLower = self.ticks
                .update(
                    params.tickLower,
                    _slot0.tick,
                    liquidityDelta128,
                    self.feeGrowthGlobal0X128,
                    self.feeGrowthGlobal1X128,
                    false,
                    maxLiquidityPerTick
                );
            if (flippedLower) {
                self.tickBitmap.flipTick(params.tickLower, params.tickSpacing);
            }

            // Update upper tick
            bool flippedUpper = self.ticks
                .update(
                    params.tickUpper,
                    _slot0.tick,
                    liquidityDelta128,
                    self.feeGrowthGlobal0X128,
                    self.feeGrowthGlobal1X128,
                    true,
                    maxLiquidityPerTick
                );
            if (flippedUpper) {
                self.tickBitmap.flipTick(params.tickUpper, params.tickSpacing);
            }
        }

        // Get fee growth inside the position range
        (uint256 feeGrowthInside0X128, uint256 feeGrowthInside1X128) = self.ticks
            .getFeeGrowthInside(
                params.tickLower,
                params.tickUpper,
                _slot0.tick,
                self.feeGrowthGlobal0X128,
                self.feeGrowthGlobal1X128
            );

        Position.Info storage position =
            self.positions.get(params.owner, params.tickLower, params.tickUpper);
        position.update(liquidityDelta128, feeGrowthInside0X128, feeGrowthInside1X128);

        // Calculate token deltas based on current price relative to range
        int256 amount0;
        int256 amount1;

        if (liquidityDelta128 != 0) {
            if (_slot0.tick < params.tickLower) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    liquidityDelta128
                );
            } else if (_slot0.tick < params.tickUpper) {
                amount0 = SqrtPriceMath.getAmount0Delta(
                    _slot0.sqrtPriceX96,
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    liquidityDelta128
                );
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    _slot0.sqrtPriceX96,
                    liquidityDelta128
                );
                self.liquidity = LiquidityMath.addDelta(self.liquidity, liquidityDelta128);
            } else {
                amount1 = SqrtPriceMath.getAmount1Delta(
                    TickMath.getSqrtPriceAtTick(params.tickLower),
                    TickMath.getSqrtPriceAtTick(params.tickUpper),
                    liquidityDelta128
                );
            }
        }

        delta = BalanceDeltaLibrary.toBalanceDelta(
            SafeCast.toInt128(amount0), SafeCast.toInt128(amount1)
        );
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
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

    function swap(State storage self, SwapParams memory params, int24 tickSpacing, uint24 fee)
        internal
        returns (BalanceDelta delta)
    {
        if (params.amountSpecified == 0) revert ZeroLiquidity();

        Slot0 memory _slot0 = self.slot0;
        if (_slot0.sqrtPriceX96 == 0) revert NotInitialized();

        if (params.zeroForOne) {
            if (
                params.sqrtPriceLimitX96 >= _slot0.sqrtPriceX96
                    || params.sqrtPriceLimitX96 <= TickMath.MIN_SQRT_PRICE
            ) {
                revert InvalidPriceLimit();
            }
        } else {
            if (
                params.sqrtPriceLimitX96 <= _slot0.sqrtPriceX96
                    || params.sqrtPriceLimitX96 >= TickMath.MAX_SQRT_PRICE
            ) {
                revert InvalidPriceLimit();
            }
        }

        bool exactInput = params.amountSpecified > 0;

        SwapState memory state = SwapState({
            amountSpecifiedRemaining: params.amountSpecified,
            amountCalculated: 0,
            sqrtPriceX96: _slot0.sqrtPriceX96,
            tick: _slot0.tick,
            feeGrowthGlobalX128: params.zeroForOne
                ? self.feeGrowthGlobal0X128
                : self.feeGrowthGlobal1X128,
            protocolFee: 0,
            liquidity: self.liquidity
        });

        while (
            state.amountSpecifiedRemaining != 0 && state.sqrtPriceX96 != params.sqrtPriceLimitX96
        ) {
            StepComputations memory step;
            step.sqrtPriceStartX96 = state.sqrtPriceX96;

            (step.tickNext, step.initialized) = self.tickBitmap
                .nextInitializedTickWithinOneWord(state.tick, tickSpacing, params.zeroForOne);

            if (step.tickNext < TickMath.MIN_TICK) {
                step.tickNext = TickMath.MIN_TICK;
            } else if (step.tickNext > TickMath.MAX_TICK) {
                step.tickNext = TickMath.MAX_TICK;
            }

            step.sqrtPriceNextX96 = TickMath.getSqrtPriceAtTick(step.tickNext);

            (state.sqrtPriceX96, step.amountIn, step.amountOut, step.feeAmount) =
                SwapMath.computeSwapStep(
                    state.sqrtPriceX96,
                    (params.zeroForOne
                            ? step.sqrtPriceNextX96 < params.sqrtPriceLimitX96
                            : step.sqrtPriceNextX96 > params.sqrtPriceLimitX96)
                        ? params.sqrtPriceLimitX96
                        : step.sqrtPriceNextX96,
                    state.liquidity,
                    state.amountSpecifiedRemaining,
                    fee
                );

            if (exactInput) {
                unchecked {
                    state.amountSpecifiedRemaining -= (step.amountIn + step.feeAmount).toInt256();
                }
                state.amountCalculated = state.amountCalculated - step.amountOut.toInt256();
            } else {
                unchecked {
                    state.amountSpecifiedRemaining += step.amountOut.toInt256();
                }
                state.amountCalculated =
                    state.amountCalculated + (step.amountIn + step.feeAmount).toInt256();
            }

            // Protocol fee calculation (fraction of feeAmount if enabled)
            if (_slot0.protocolFee > 0) {
                uint256 deltaProtocolFee =
                    FullMath.mulDiv(step.feeAmount, _slot0.protocolFee, 1_000_000);
                step.feeAmount -= deltaProtocolFee;
                state.protocolFee += deltaProtocolFee.toUint128();
            }

            if (state.liquidity > 0) {
                state.feeGrowthGlobalX128 += FullMath.mulDiv(
                    step.feeAmount, FixedPoint128.Q128, state.liquidity
                );
            }

            if (state.sqrtPriceX96 == step.sqrtPriceNextX96) {
                if (step.initialized) {
                    int128 liquidityNet = self.ticks
                        .cross(
                            step.tickNext,
                            params.zeroForOne
                                ? state.feeGrowthGlobalX128
                                : self.feeGrowthGlobal0X128,
                            params.zeroForOne
                                ? self.feeGrowthGlobal1X128
                                : state.feeGrowthGlobalX128
                        );

                    if (params.zeroForOne) {
                        liquidityNet = -liquidityNet;
                    }

                    state.liquidity = LiquidityMath.addDelta(state.liquidity, liquidityNet);
                }

                state.tick = params.zeroForOne ? step.tickNext - 1 : step.tickNext;
            } else if (state.sqrtPriceX96 != step.sqrtPriceStartX96) {
                state.tick = TickMath.getTickAtSqrtPrice(state.sqrtPriceX96);
            }
        }

        // Update global pool state
        if (state.tick != _slot0.tick) {
            (self.slot0.sqrtPriceX96, self.slot0.tick) = (state.sqrtPriceX96, state.tick);
        } else {
            self.slot0.sqrtPriceX96 = state.sqrtPriceX96;
        }

        if (self.liquidity != state.liquidity) {
            self.liquidity = state.liquidity;
        }

        if (params.zeroForOne) {
            self.feeGrowthGlobal0X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) self.protocolFees0 += state.protocolFee;
        } else {
            self.feeGrowthGlobal1X128 = state.feeGrowthGlobalX128;
            if (state.protocolFee > 0) self.protocolFees1 += state.protocolFee;
        }

        (int256 amount0, int256 amount1) = params.zeroForOne == exactInput
            ? (params.amountSpecified - state.amountSpecifiedRemaining, state.amountCalculated)
            : (state.amountCalculated, params.amountSpecified - state.amountSpecifiedRemaining);

        delta = BalanceDeltaLibrary.toBalanceDelta(
            SafeCast.toInt128(amount0), SafeCast.toInt128(amount1)
        );
    }

    function donate(State storage self, uint256 amount0, uint256 amount1)
        internal
        returns (BalanceDelta delta)
    {
        if (self.slot0.sqrtPriceX96 == 0) revert NotInitialized();
        if (self.liquidity == 0) revert ZeroLiquidity();

        if (amount0 > 0) {
            self.feeGrowthGlobal0X128 += FullMath.mulDiv(
                amount0, FixedPoint128.Q128, self.liquidity
            );
        }
        if (amount1 > 0) {
            self.feeGrowthGlobal1X128 += FullMath.mulDiv(
                amount1, FixedPoint128.Q128, self.liquidity
            );
        }

        delta = BalanceDeltaLibrary.toBalanceDelta(
            SafeCast.toInt128(int256(amount0)), SafeCast.toInt128(int256(amount1))
        );
    }
}
