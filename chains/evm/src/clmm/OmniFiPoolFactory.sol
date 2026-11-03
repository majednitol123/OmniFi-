// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiPoolFactory } from "../interfaces/IOmniFiPoolFactory.sol";
import { IOmniFiPoolDeployer } from "../interfaces/IOmniFiPoolDeployer.sol";
import { OmniFiPool } from "./OmniFiPool.sol";

/// @title OmniFi CLMM Pool Factory
/// @notice Deploys OmniFi concentrated-liquidity pools and manages fee tiers and protocol parameters
contract OmniFiPoolFactory is IOmniFiPoolFactory, IOmniFiPoolDeployer {
    error NotOwner();
    error ZeroAddress();
    error IdenticalAddresses();
    error FeeTierNotSupported();
    error FeeTierAlreadyEnabled();
    error InvalidTickSpacing();
    error PoolAlreadyExists();
    error InvalidProtocolFeeFraction();

    address public override owner;
    address public override feeRecipient;
    uint8 public override defaultProtocolFeeFraction;

    mapping(uint24 => int24) public override feeTierTickSpacing;
    mapping(address => mapping(address => mapping(uint24 => address))) public override getPool;
    address[] public override allPools;

    Parameters public override parameters;

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address _owner, address _feeRecipient) {
        if (_owner == address(0) || _feeRecipient == address(0)) revert ZeroAddress();
        owner = _owner;
        feeRecipient = _feeRecipient;

        // Default supported fee tiers
        _enableFeeTier(100, 1);
        _enableFeeTier(500, 10);
        _enableFeeTier(3000, 60);
        _enableFeeTier(10_000, 200);
    }

    function allPoolsLength() external view override returns (uint256) {
        return allPools.length;
    }

    function _enableFeeTier(uint24 fee, int24 tickSpacing) private {
        feeTierTickSpacing[fee] = tickSpacing;
        emit FeeTierEnabled(fee, tickSpacing);
    }

    /// @inheritdoc IOmniFiPoolFactory
    function enableFeeTier(uint24 fee, int24 tickSpacing) external override onlyOwner {
        if (fee >= 1_000_000) revert FeeTierNotSupported();
        if (tickSpacing <= 0 || tickSpacing > 16_384) revert InvalidTickSpacing();
        if (feeTierTickSpacing[fee] != 0) revert FeeTierAlreadyEnabled();

        _enableFeeTier(fee, tickSpacing);
    }

    /// @inheritdoc IOmniFiPoolFactory
    function setFeeRecipient(address newRecipient) external override onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit SetFeeRecipient(oldRecipient, newRecipient);
    }

    /// @inheritdoc IOmniFiPoolFactory
    function setDefaultProtocolFeeFraction(uint8 newFraction) external override onlyOwner {
        if (newFraction > 4) revert InvalidProtocolFeeFraction();
        uint8 oldFraction = defaultProtocolFeeFraction;
        defaultProtocolFeeFraction = newFraction;
        emit SetDefaultProtocolFeeFraction(oldFraction, newFraction);
    }

    /// @inheritdoc IOmniFiPoolFactory
    function setPoolProtocolFeeFraction(address pool, uint8 newFraction)
        external
        override
        onlyOwner
    {
        if (newFraction > 4) revert InvalidProtocolFeeFraction();
        OmniFiPool(pool).setProtocolFeeFraction(newFraction);
    }

    /// @inheritdoc IOmniFiPoolFactory
    function createPool(address tokenA, address tokenB, uint24 fee)
        external
        override
        returns (address pool)
    {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();

        int24 tickSpacing = feeTierTickSpacing[fee];
        if (tickSpacing == 0) revert FeeTierNotSupported();
        if (getPool[token0][token1][fee] != address(0)) revert PoolAlreadyExists();

        parameters = Parameters({
            factory: address(this),
            token0: token0,
            token1: token1,
            fee: fee,
            tickSpacing: tickSpacing
        });

        bytes32 salt = keccak256(abi.encode(token0, token1, fee));
        pool = address(new OmniFiPool{ salt: salt }());
        delete parameters;

        getPool[token0][token1][fee] = pool;
        getPool[token1][token0][fee] = pool;
        allPools.push(pool);

        emit PoolCreated(token0, token1, fee, tickSpacing, pool);
    }
}
