// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiV2Factory } from "../interfaces/IOmniFiV2Factory.sol";
import { IOmniFiV2Pair } from "../interfaces/IOmniFiV2Pair.sol";
import { OmniFiV2Pair } from "./OmniFiV2Pair.sol";

/// @title OmniFi V2 Factory
/// @notice Registry and CREATE2 deployer for OmniFi V2 constant-product pairs
contract OmniFiV2Factory is IOmniFiV2Factory {
    address public owner;
    address public override feeRecipient;
    uint8 public override protocolFeeFraction; // 0 = off, 1 = 25% of LP fee

    mapping(address => mapping(address => address)) public override getPair;
    address[] public override allPairs;

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor(address owner_, address feeRecipient_) {
        if (owner_ == address(0) || feeRecipient_ == address(0)) revert ZeroAddress();
        owner = owner_;
        feeRecipient = feeRecipient_;
    }

    /// @notice Returns the total number of deployed pairs
    function allPairsLength() external view override returns (uint256) {
        return allPairs.length;
    }

    /// @notice Creates a new pair for two unique tokens via CREATE2
    /// @param tokenA First token address
    /// @param tokenB Second token address
    /// @return pair Deployed pair address
    function createPair(address tokenA, address tokenB) external override returns (address pair) {
        if (tokenA == tokenB) revert IdenticalAddresses();
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        if (token0 == address(0)) revert ZeroAddress();
        if (getPair[token0][token1] != address(0)) revert PairExists();

        bytes memory bytecode = type(OmniFiV2Pair).creationCode;
        bytes32 salt = keccak256(abi.encodePacked(token0, token1));
        assembly {
            pair := create2(0, add(bytecode, 32), mload(bytecode), salt)
        }
        if (pair == address(0)) revert ZeroAddress();

        IOmniFiV2Pair(pair).initialize(token0, token1);

        getPair[token0][token1] = pair;
        getPair[token1][token0] = pair; // Bidirectional mapping
        allPairs.push(pair);

        emit PairCreated(token0, token1, pair, allPairs.length);
    }

    /// @notice Updates the protocol fee fraction (0 = 0%, 1 = 25%)
    /// @param newFraction New protocol fee fraction (maximum 1)
    function setProtocolFeeFraction(uint8 newFraction) external override onlyOwner {
        if (newFraction > 1) revert ExceedsMaxProtocolFee();
        uint8 oldFraction = protocolFeeFraction;
        protocolFeeFraction = newFraction;
        emit ProtocolFeeFractionUpdated(oldFraction, newFraction);
    }

    /// @notice Updates the protocol fee recipient address
    /// @param newRecipient New recipient address
    function setFeeRecipient(address newRecipient) external override onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        address oldRecipient = feeRecipient;
        feeRecipient = newRecipient;
        emit FeeRecipientUpdated(oldRecipient, newRecipient);
    }

    /// @notice Transfers ownership of the factory
    /// @param newOwner New owner address
    function setOwner(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        owner = newOwner;
    }
}
