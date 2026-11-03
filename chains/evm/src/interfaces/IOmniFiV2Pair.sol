// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IERC20Minimal } from "./IERC20Minimal.sol";

/// @title OmniFi V2 Pair Interface
/// @notice Core constant-product AMM pair interface (x * y = k)
interface IOmniFiV2Pair is IERC20Minimal {
    event Swap(
        address indexed sender,
        uint256 amount0In,
        uint256 amount1In,
        uint256 amount0Out,
        uint256 amount1Out,
        address indexed to
    );
    event Mint(
        address indexed sender,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity,
        address indexed to
    );
    event Burn(
        address indexed sender,
        uint256 amount0,
        uint256 amount1,
        uint256 liquidity,
        address indexed to
    );
    event Sync(uint112 reserve0, uint112 reserve1);
    event ProtocolFeeCollected(address indexed recipient, uint256 amount0, uint256 amount1);

    error InsufficientLiquidity();
    error InsufficientInputAmount();
    error InsufficientOutputAmount();
    error InvalidTo();
    error Overflow();
    error Locked();
    error Unauthorized();
    error ZeroAddress();

    function MINIMUM_LIQUIDITY() external pure returns (uint256);
    function factory() external view returns (address);
    function token0() external view returns (address);
    function token1() external view returns (address);
    function fee() external pure returns (uint24);

    function getReserves()
        external
        view
        returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);

    function price0CumulativeLast() external view returns (uint256);
    function price1CumulativeLast() external view returns (uint256);
    function protocolFees(address token) external view returns (uint256);

    function initialize(address token0_, address token1_) external;
    function mint(address to) external returns (uint256 liquidity);
    function burn(address to) external returns (uint256 amount0, uint256 amount1);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
    function sync() external;
    function skim(address to) external;
    function collectProtocolFees(
        address recipient,
        uint256 amount0Requested,
        uint256 amount1Requested
    ) external returns (uint256 amount0, uint256 amount1);
}
