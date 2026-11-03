// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Currency } from "../v4-core/types/Currency.sol";
import { PoolKey } from "../v4-core/types/PoolKey.sol";
import { PoolId } from "../v4-core/types/PoolId.sol";
import { BalanceDelta } from "../v4-core/types/BalanceDelta.sol";

/// @title IOmniFiPoolManager
/// @notice Core interface for the OmniFi EVM v4-inspired Singleton Pool Manager
interface IOmniFiPoolManager {
    struct ModifyLiquidityParams {
        int24 tickLower;
        int24 tickUpper;
        int256 liquidityDelta;
    }

    struct SwapParams {
        bool zeroForOne;
        int256 amountSpecified;
        uint160 sqrtPriceLimitX96;
    }

    event Initialize(
        PoolId indexed id,
        Currency indexed currency0,
        Currency indexed currency1,
        uint24 fee,
        int24 tickSpacing,
        address hooks,
        uint160 sqrtPriceX96,
        int24 tick
    );

    event ModifyLiquidity(
        PoolId indexed id,
        address indexed sender,
        int24 tickLower,
        int24 tickUpper,
        int256 liquidityDelta
    );

    event Swap(
        PoolId indexed id,
        address indexed sender,
        int128 amount0,
        int128 amount1,
        uint160 sqrtPriceX96,
        uint128 liquidity,
        int24 tick,
        uint24 fee
    );

    event Donate(PoolId indexed id, address indexed sender, uint256 amount0, uint256 amount1);

    event ProtocolFeeUpdated(PoolId indexed id, uint24 protocolFee);
    event PoolPaused(PoolId indexed id, bool isPaused);

    error CurrenciesUnsortedOrEqual();
    error FeeTierNotSupported();
    error PoolAlreadyInitialized();
    error PoolNotInitialized();
    error PoolIsPaused();
    error AlreadyUnlocked();
    error NotUnlocked();
    error NotActiveLocker();
    error CurrencyDeltaNotZero(Currency currency, int256 delta);
    error InsufficientCredit();
    error NoExcessDebt();
    error NativeTransferFailed();
    error NonZeroMsgValueForERC20();
    error InsufficientMsgValue();
    error HooksNotSupportedInR1();
    error Unauthorized();

    function unlock(bytes calldata data) external returns (bytes memory result);

    function initialize(PoolKey memory key, uint160 sqrtPriceX96) external returns (int24 tick);

    function modifyLiquidity(PoolKey memory key, ModifyLiquidityParams memory params)
        external
        returns (BalanceDelta delta);

    function swap(PoolKey memory key, SwapParams memory params)
        external
        returns (BalanceDelta delta);

    function donate(PoolKey memory key, uint256 amount0, uint256 amount1)
        external
        returns (BalanceDelta delta);

    function settle(Currency currency) external payable returns (uint256 paid);

    function take(Currency currency, address to, uint256 amount) external;

    function getDelta(address locker, Currency currency) external view returns (int256);

    function getSlot0(PoolId poolId)
        external
        view
        returns (uint160 sqrtPriceX96, int24 tick, uint24 protocolFee, bool isPaused);

    function getLiquidity(PoolId poolId) external view returns (uint128);

    function getFeeGrowthGlobals(PoolId poolId)
        external
        view
        returns (uint256 feeGrowthGlobal0X128, uint256 feeGrowthGlobal1X128);
}
