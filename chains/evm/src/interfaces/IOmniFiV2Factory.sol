// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title OmniFi V2 Factory Interface
/// @notice Deploys and registers canonical OmniFi V2 pairs via CREATE2
interface IOmniFiV2Factory {
    event PairCreated(
        address indexed token0, address indexed token1, address pair, uint256 allPairsLength
    );
    event ProtocolFeeFractionUpdated(uint8 oldFraction, uint8 newFraction);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);

    error IdenticalAddresses();
    error ZeroAddress();
    error PairExists();
    error Unauthorized();
    error ExceedsMaxProtocolFee();

    function feeRecipient() external view returns (address);
    function protocolFeeFraction() external view returns (uint8);

    function getPair(address tokenA, address tokenB) external view returns (address pair);
    function allPairs(uint256 index) external view returns (address pair);
    function allPairsLength() external view returns (uint256);

    function createPair(address tokenA, address tokenB) external returns (address pair);

    function setProtocolFeeFraction(uint8 newFraction) external;
    function setFeeRecipient(address newRecipient) external;
}
