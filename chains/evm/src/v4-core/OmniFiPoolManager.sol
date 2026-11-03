// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiPoolManager } from "../interfaces/IOmniFiPoolManager.sol";
import { IUnlockCallback } from "../interfaces/IUnlockCallback.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { TransferHelper } from "../v2/libraries/TransferHelper.sol";

import { Currency, CurrencyLibrary } from "./types/Currency.sol";
import { PoolKey } from "./types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "./types/PoolId.sol";
import { BalanceDelta, BalanceDeltaLibrary } from "./types/BalanceDelta.sol";
import { TransientStorage } from "./libraries/TransientStorage.sol";
import { Pool } from "./libraries/Pool.sol";

/// @title OmniFiPoolManager
/// @notice Production-grade EVM v4-inspired Singleton Pool Manager with Cancun EIP-1153 Flash Accounting
contract OmniFiPoolManager is IOmniFiPoolManager {
    using PoolIdLibrary for PoolKey;
    using BalanceDeltaLibrary for BalanceDelta;
    using Pool for Pool.State;

    address public owner;
    address public immutable protocolFeeController;

    mapping(PoolId => Pool.State) internal _pools;

    modifier onlyUnlocked() {
        if (TransientStorage.tload(TransientStorage.LOCK_SLOT) != 1) {
            revert NotUnlocked();
        }
        if (msg.sender != address(uint160(TransientStorage.tload(TransientStorage.ACTIVE_LOCKER_SLOT)))) {
            revert NotActiveLocker();
        }
        _;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address _owner, address _protocolFeeController) {
        owner = _owner;
        protocolFeeController = _protocolFeeController;
    }

    /// @inheritdoc IOmniFiPoolManager
    function unlock(bytes calldata data) external override returns (bytes memory result) {
        if (TransientStorage.tload(TransientStorage.LOCK_SLOT) != 0) {
            revert AlreadyUnlocked();
        }

        // Set lock flag and register active locker
        TransientStorage.tstore(TransientStorage.LOCK_SLOT, 1);
        TransientStorage.tstore(TransientStorage.ACTIVE_LOCKER_SLOT, uint256(uint160(msg.sender)));

        // Execute caller callback
        result = IUnlockCallback(msg.sender).unlockCallback(data);

        // Verify that all touched currencies for this caller have zero delta
        bytes32 countSlot = TransientStorage.currencyCountSlot(msg.sender);
        uint256 count = TransientStorage.tload(countSlot);

        for (uint256 i = 0; i < count; i++) {
            bytes32 itemSlot = TransientStorage.currencyItemSlot(msg.sender, i);
            Currency currency = Currency.wrap(address(uint160(TransientStorage.tload(itemSlot))));
            int256 delta = TransientStorage.getDelta(msg.sender, currency);

            if (delta != 0) {
                revert CurrencyDeltaNotZero(currency, delta);
            }
        }

        // Clear lock flag and active locker
        TransientStorage.tstore(TransientStorage.LOCK_SLOT, 0);
        TransientStorage.tstore(TransientStorage.ACTIVE_LOCKER_SLOT, 0);
    }

    /// @inheritdoc IOmniFiPoolManager
    function initialize(PoolKey memory key, uint160 sqrtPriceX96)
        external
        override
        returns (int24 tick)
    {
        if (!(key.currency0 < key.currency1)) {
            revert CurrenciesUnsortedOrEqual();
        }

        // R1 safety gate: Hooks are disabled per ADR-004
        if (key.hooks != address(0)) {
            revert HooksNotSupportedInR1();
        }

        // Supported fee tiers per ADR-007
        if (key.fee != 100 && key.fee != 500 && key.fee != 3000 && key.fee != 10_000) {
            revert FeeTierNotSupported();
        }

        PoolId poolId = key.toId();
        tick = _pools[poolId].initialize(sqrtPriceX96, 0);

        emit Initialize(
            poolId,
            key.currency0,
            key.currency1,
            key.fee,
            key.tickSpacing,
            key.hooks,
            sqrtPriceX96,
            tick
        );
    }

    /// @inheritdoc IOmniFiPoolManager
    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        override
        onlyUnlocked
        returns (BalanceDelta delta)
    {
        PoolId poolId = key.toId();
        Pool.State storage pool = _pools[poolId];

        if (pool.slot0.sqrtPriceX96 == 0) revert PoolNotInitialized();
        if (pool.slot0.isPaused) revert PoolIsPaused();

        delta = pool.modifyLiquidity(
            Pool.ModifyPositionParams({
                owner: msg.sender,
                tickLower: params.tickLower,
                tickUpper: params.tickUpper,
                liquidityDelta: params.liquidityDelta,
                tickSpacing: key.tickSpacing
            })
        );

        // Apply signed deltas to transient accounting
        TransientStorage.applyDelta(msg.sender, key.currency0, delta.amount0());
        TransientStorage.applyDelta(msg.sender, key.currency1, delta.amount1());

        emit ModifyLiquidity(
            poolId, msg.sender, params.tickLower, params.tickUpper, params.liquidityDelta
        );
    }

    /// @inheritdoc IOmniFiPoolManager
    function swap(PoolKey memory key, SwapParams memory params)
        external
        override
        onlyUnlocked
        returns (BalanceDelta delta)
    {
        PoolId poolId = key.toId();
        Pool.State storage pool = _pools[poolId];

        if (pool.slot0.sqrtPriceX96 == 0) revert PoolNotInitialized();
        if (pool.slot0.isPaused) revert PoolIsPaused();

        delta = pool.swap(
            Pool.SwapParams({
                zeroForOne: params.zeroForOne,
                amountSpecified: params.amountSpecified,
                sqrtPriceLimitX96: params.sqrtPriceLimitX96
            }),
            key.tickSpacing,
            key.fee
        );

        // Apply signed deltas to transient accounting
        TransientStorage.applyDelta(msg.sender, key.currency0, delta.amount0());
        TransientStorage.applyDelta(msg.sender, key.currency1, delta.amount1());

        emit Swap(
            poolId,
            msg.sender,
            delta.amount0(),
            delta.amount1(),
            pool.slot0.sqrtPriceX96,
            pool.liquidity,
            pool.slot0.tick,
            key.fee
        );
    }

    /// @inheritdoc IOmniFiPoolManager
    function donate(PoolKey memory key, uint256 amount0, uint256 amount1)
        external
        override
        onlyUnlocked
        returns (BalanceDelta delta)
    {
        PoolId poolId = key.toId();
        Pool.State storage pool = _pools[poolId];

        if (pool.slot0.sqrtPriceX96 == 0) revert PoolNotInitialized();
        if (pool.slot0.isPaused) revert PoolIsPaused();

        delta = pool.donate(amount0, amount1);

        TransientStorage.applyDelta(msg.sender, key.currency0, int256(amount0));
        TransientStorage.applyDelta(msg.sender, key.currency1, int256(amount1));

        emit Donate(poolId, msg.sender, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPoolManager
    function settle(Currency currency)
        external
        payable
        override
        onlyUnlocked
        returns (uint256 paid)
    {
        int256 delta = TransientStorage.getDelta(msg.sender, currency);
        if (delta <= 0) revert NoExcessDebt();

        uint256 owed = uint256(delta);

        if (CurrencyLibrary.isNative(currency)) {
            if (msg.value < owed) revert InsufficientMsgValue();
            paid = owed;
            TransientStorage.applyDelta(msg.sender, currency, -delta);

            // Refund any excess ETH
            if (msg.value > owed) {
                uint256 excess = msg.value - owed;
                (bool success,) = payable(msg.sender).call{ value: excess }("");
                if (!success) revert NativeTransferFailed();
            }
        } else {
            if (msg.value != 0) revert NonZeroMsgValueForERC20();
            paid = owed;
            TransientStorage.applyDelta(msg.sender, currency, -delta);
            TransferHelper.safeTransferFrom(
                Currency.unwrap(currency), msg.sender, address(this), owed
            );
        }
    }

    /// @inheritdoc IOmniFiPoolManager
    function take(Currency currency, address to, uint256 amount) external override onlyUnlocked {
        int256 delta = TransientStorage.getDelta(msg.sender, currency);
        if (-delta < int256(amount)) revert InsufficientCredit();

        TransientStorage.applyDelta(msg.sender, currency, int256(amount));

        if (CurrencyLibrary.isNative(currency)) {
            (bool success,) = payable(to).call{ value: amount }("");
            if (!success) revert NativeTransferFailed();
        } else {
            TransferHelper.safeTransfer(Currency.unwrap(currency), to, amount);
        }
    }

    /// @inheritdoc IOmniFiPoolManager
    function getDelta(address locker, Currency currency) external view override returns (int256) {
        return TransientStorage.getDelta(locker, currency);
    }

    /// @inheritdoc IOmniFiPoolManager
    function getSlot0(PoolId poolId)
        external
        view
        override
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, bool isPaused)
    {
        Pool.Slot0 memory s = _pools[poolId].slot0;
        return (s.sqrtPriceX96, s.tick, s.protocolFee, s.isPaused);
    }

    /// @inheritdoc IOmniFiPoolManager
    function getLiquidity(PoolId poolId) external view override returns (uint128) {
        return _pools[poolId].liquidity;
    }

    /// @inheritdoc IOmniFiPoolManager
    function getFeeGrowthGlobals(PoolId poolId)
        external
        view
        override
        returns (uint256 feeGrowthGlobal0X128, uint256 feeGrowthGlobal1X128)
    {
        return (_pools[poolId].feeGrowthGlobal0X128, _pools[poolId].feeGrowthGlobal1X128);
    }

    function setProtocolFee(PoolId poolId, uint24 protocolFee) external {
        if (msg.sender != protocolFeeController && msg.sender != owner) revert Unauthorized();
        _pools[poolId].slot0.protocolFee = protocolFee;
        emit ProtocolFeeUpdated(poolId, protocolFee);
    }

    function setPoolPaused(PoolId poolId, bool isPaused) external onlyOwner {
        _pools[poolId].slot0.isPaused = isPaused;
        emit PoolPaused(poolId, isPaused);
    }

    receive() external payable {
        // Only accept ETH through settle
        if (TransientStorage.tload(TransientStorage.LOCK_SLOT) != 1) {
            revert Unauthorized();
        }
    }
}
