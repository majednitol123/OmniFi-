// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/// @title Path
/// @notice Functions for manipulating path bytes used in multi-hop swaps
library Path {
    /// @dev The length of the bytes encoded address
    uint256 private constant ADDR_SIZE = 20;
    /// @dev The length of the bytes encoded fee
    uint256 private constant FEE_SIZE = 3;

    /// @dev The offset of a single token address and pool fee
    uint256 private constant NEXT_OFFSET = ADDR_SIZE + FEE_SIZE;
    /// @dev The offset of an encoded pool key
    uint256 private constant POP_OFFSET = NEXT_OFFSET + ADDR_SIZE;
    /// @dev The minimum length of an encoded path that contains 2 tokens and a fee
    uint256 private constant MULTIHOP_HEADER_SIZE = POP_OFFSET;

    /// @notice Returns true iff the path contains two or more pools
    function hasMultiplePools(bytes memory path) internal pure returns (bool) {
        return path.length >= MULTIHOP_HEADER_SIZE + NEXT_OFFSET;
    }

    /// @notice Returns the number of pools in the path
    function numPools(bytes memory path) internal pure returns (uint256) {
        return (path.length - ADDR_SIZE) / NEXT_OFFSET;
    }

    /// @notice Decodes the first pool in path
    function decodeFirstPool(bytes memory path)
        internal
        pure
        returns (address tokenA, address tokenB, uint24 fee)
    {
        assembly {
            tokenA := shr(96, mload(add(path, 0x20)))
            fee := shr(232, mload(add(path, 0x34)))
            tokenB := shr(96, mload(add(path, 0x37)))
        }
    }

    /// @notice Skips a token + fee element from the path
    function skipToken(bytes memory path) internal pure returns (bytes memory) {
        return slice(path, NEXT_OFFSET, path.length - NEXT_OFFSET);
    }

    /// @notice Slices path bytes
    function slice(bytes memory _bytes, uint256 _start, uint256 _length)
        internal
        pure
        returns (bytes memory)
    {
        require(_bytes.length >= _start + _length);

        bytes memory tempBytes = new bytes(_length);
        for (uint256 i = 0; i < _length; i++) {
            tempBytes[i] = _bytes[_start + i];
        }
        return tempBytes;
    }
}
