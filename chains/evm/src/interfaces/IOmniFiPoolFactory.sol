// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title The interface for the OmniFi CLMM Factory
interface IOmniFiPoolFactory {
    event PoolCreated(
        address indexed token0,
        address indexed token1,
        uint24 indexed fee,
        int24 tickSpacing,
        address pool
    );

    event FeeTierEnabled(uint24 indexed fee, int24 indexed tickSpacing);
    event SetFeeRecipient(address indexed oldRecipient, address indexed newRecipient);
    event SetDefaultProtocolFeeFraction(uint8 oldFraction, uint8 newFraction);

    function owner() external view returns (address);
    function feeRecipient() external view returns (address);
    function defaultProtocolFeeFraction() external view returns (uint8);
    function feeTierTickSpacing(uint24 fee) external view returns (int24);
    function getPool(address tokenA, address tokenB, uint24 fee)
        external
        view
        returns (address pool);
    function allPools(uint256 index) external view returns (address pool);
    function allPoolsLength() external view returns (uint256);

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool);

    function enableFeeTier(uint24 fee, int24 tickSpacing) external;
    function setFeeRecipient(address newRecipient) external;
    function setDefaultProtocolFeeFraction(uint8 newFraction) external;
    function setPoolProtocolFeeFraction(address pool, uint8 newFraction) external;
}
