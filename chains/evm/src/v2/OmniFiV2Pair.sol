// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IOmniFiV2Pair } from "../interfaces/IOmniFiV2Pair.sol";
import { IOmniFiV2Factory } from "../interfaces/IOmniFiV2Factory.sol";
import { IERC20Minimal } from "../interfaces/IERC20Minimal.sol";
import { OmniFiV2ERC20 } from "./OmniFiV2ERC20.sol";
import { TransferHelper } from "./libraries/TransferHelper.sol";
import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title OmniFi V2 Pair Contract
/// @notice Core constant-product AMM pair maintaining reserves, TWAP oracles, and direct protocol fee accumulation
contract OmniFiV2Pair is IOmniFiV2Pair, OmniFiV2ERC20 {
    uint24 public constant override fee = 3000; // 0.30%
    uint24 public constant FEE_DENOMINATOR = 1_000_000;
    uint8 public constant PROTOCOL_FEE_DENOMINATOR = 4;
    uint256 public constant override MINIMUM_LIQUIDITY = 1000;

    address public immutable override factory;
    address public override token0;
    address public override token1;

    uint112 private reserve0;
    uint112 private reserve1;
    uint32 private blockTimestampLast;

    uint256 public override price0CumulativeLast;
    uint256 public override price1CumulativeLast;

    mapping(address => uint256) public override protocolFees;

    uint256 private _status = 1;

    modifier nonReentrant() {
        _nonReentrantBefore();
        _;
        _nonReentrantAfter();
    }

    function _nonReentrantBefore() private {
        if (_status != 1) revert Locked();
        _status = 2;
    }

    function _nonReentrantAfter() private {
        _status = 1;
    }

    constructor() {
        factory = msg.sender;
    }

    /// @notice Returns current reserves and block timestamp of last reserve update
    function getReserves()
        public
        view
        override
        returns (uint112 _reserve0, uint112 _reserve1, uint32 _blockTimestampLast)
    {
        _reserve0 = reserve0;
        _reserve1 = reserve1;
        _blockTimestampLast = blockTimestampLast;
    }

    /// @notice Initializes pair with canonical token addresses; called once by factory
    function initialize(address token0_, address token1_) external override {
        if (msg.sender != factory) revert Unauthorized();
        token0 = token0_;
        token1 = token1_;
    }

    /// @notice Updates reserves and cumulative TWAP price accumulators
    function _update(uint256 balance0, uint256 balance1, uint112 _reserve0, uint112 _reserve1)
        private
    {
        if (balance0 > type(uint112).max || balance1 > type(uint112).max) revert Overflow();

        uint32 blockTimestamp = uint32(block.timestamp % 2 ** 32);
        uint32 timeElapsed;
        unchecked {
            timeElapsed = blockTimestamp - blockTimestampLast;
        }

        if (timeElapsed > 0 && _reserve0 != 0 && _reserve1 != 0) {
            unchecked {
                // UQ112x112: spot price = (reserveOther << 112) / reserveThis
                price0CumulativeLast += uint256((uint224(_reserve1) << 112) / _reserve0)
                * timeElapsed;
                price1CumulativeLast += uint256((uint224(_reserve0) << 112) / _reserve1)
                * timeElapsed;
            }
        }

        // casting to uint112 is safe due to upper bound check above
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve0 = uint112(balance0);
        // forge-lint: disable-next-line(unsafe-typecast)
        reserve1 = uint112(balance1);
        blockTimestampLast = blockTimestamp;

        emit Sync(reserve0, reserve1);
    }

    /// @notice Mints liquidity tokens to `to` based on deposited balances
    function mint(address to) external override nonReentrant returns (uint256 liquidity) {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this)) - protocolFees[token0];
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this)) - protocolFees[token1];

        uint256 amount0 = balance0 - _reserve0;
        uint256 amount1 = balance1 - _reserve1;

        uint256 _totalSupply = totalSupply;
        if (_totalSupply == 0) {
            uint256 initialLiquidity = Math.sqrt(amount0 * amount1);
            if (initialLiquidity <= MINIMUM_LIQUIDITY) revert InsufficientLiquidity();
            _mint(address(0), MINIMUM_LIQUIDITY); // Permanent lock
            liquidity = initialLiquidity - MINIMUM_LIQUIDITY;
        } else {
            liquidity = Math.min(
                (amount0 * _totalSupply) / _reserve0, (amount1 * _totalSupply) / _reserve1
            );
        }

        if (liquidity == 0) revert InsufficientLiquidity();
        _mint(to, liquidity);

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Mint(msg.sender, amount0, amount1, liquidity, to);
    }

    /// @notice Burns liquidity tokens sent to pair and delivers underlying tokens to `to`
    function burn(address to)
        external
        override
        nonReentrant
        returns (uint256 amount0, uint256 amount1)
    {
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();

        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this)) - protocolFees[token0];
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this)) - protocolFees[token1];

        uint256 liquidity = balanceOf[address(this)];
        uint256 _totalSupply = totalSupply;

        amount0 = (liquidity * balance0) / _totalSupply;
        amount1 = (liquidity * balance1) / _totalSupply;
        if (amount0 == 0 || amount1 == 0) revert InsufficientLiquidity();

        _burn(address(this), liquidity);
        TransferHelper.safeTransfer(token0, to, amount0);
        TransferHelper.safeTransfer(token1, to, amount1);

        balance0 = IERC20Minimal(token0).balanceOf(address(this)) - protocolFees[token0];
        balance1 = IERC20Minimal(token1).balanceOf(address(this)) - protocolFees[token1];

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Burn(msg.sender, amount0, amount1, liquidity, to);
    }

    /// @notice Executes a token swap enforcing the constant-product invariant x * y = k
    function swap(
        uint256 amount0Out,
        uint256 amount1Out,
        address to,
        bytes calldata /* data */
    )
        external
        override
        nonReentrant
    {
        if (amount0Out == 0 && amount1Out == 0) revert InsufficientOutputAmount();
        (uint112 _reserve0, uint112 _reserve1,) = getReserves();
        if (amount0Out >= _reserve0 || amount1Out >= _reserve1) revert InsufficientLiquidity();
        if (to == token0 || to == token1 || to == address(0)) revert InvalidTo();

        if (amount0Out > 0) TransferHelper.safeTransfer(token0, to, amount0Out);
        if (amount1Out > 0) TransferHelper.safeTransfer(token1, to, amount1Out);

        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this)) - protocolFees[token0];
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this)) - protocolFees[token1];

        uint256 amount0In =
            balance0 > _reserve0 - amount0Out ? balance0 - (_reserve0 - amount0Out) : 0;
        uint256 amount1In =
            balance1 > _reserve1 - amount1Out ? balance1 - (_reserve1 - amount1Out) : 0;
        if (amount0In == 0 && amount1In == 0) revert InsufficientInputAmount();

        {
            // Account protocol fee on the gross input fee amount
            uint8 protocolFeeFraction = IOmniFiV2Factory(factory).protocolFeeFraction();
            uint256 protoFee0;
            uint256 protoFee1;
            if (protocolFeeFraction > 0) {
                if (amount0In > 0) {
                    uint256 grossFee0 = (amount0In * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
                    protoFee0 = (grossFee0 * protocolFeeFraction) / PROTOCOL_FEE_DENOMINATOR;
                    if (protoFee0 > 0) {
                        protocolFees[token0] += protoFee0;
                        balance0 -= protoFee0;
                    }
                }
                if (amount1In > 0) {
                    uint256 grossFee1 = (amount1In * fee + FEE_DENOMINATOR - 1) / FEE_DENOMINATOR;
                    protoFee1 = (grossFee1 * protocolFeeFraction) / PROTOCOL_FEE_DENOMINATOR;
                    if (protoFee1 > 0) {
                        protocolFees[token1] += protoFee1;
                        balance1 -= protoFee1;
                    }
                }
            }

            // Verify k invariant: balanceAdjusted based on gross funds received
            uint256 balance0Adjusted = (balance0 + protoFee0) * FEE_DENOMINATOR - (amount0In * fee);
            uint256 balance1Adjusted = (balance1 + protoFee1) * FEE_DENOMINATOR - (amount1In * fee);
            if (
                Math.mulDiv(balance0Adjusted, balance1Adjusted, FEE_DENOMINATOR)
                    < uint256(_reserve0) * _reserve1 * FEE_DENOMINATOR
            ) revert InsufficientLiquidity();
        }

        _update(balance0, balance1, _reserve0, _reserve1);
        emit Swap(msg.sender, amount0In, amount1In, amount0Out, amount1Out, to);
    }

    /// @notice Force balances to match stored reserves minus protocol fees
    function sync() external override nonReentrant {
        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this)) - protocolFees[token0];
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this)) - protocolFees[token1];
        _update(balance0, balance1, reserve0, reserve1);
    }

    /// @notice Recovers excess tokens beyond reserves and accrued protocol fees
    function skim(address to) external override nonReentrant {
        if (to == token0 || to == token1 || to == address(0)) revert InvalidTo();

        uint256 balance0 = IERC20Minimal(token0).balanceOf(address(this));
        uint256 balance1 = IERC20Minimal(token1).balanceOf(address(this));

        uint256 expected0 = uint256(reserve0) + protocolFees[token0];
        uint256 expected1 = uint256(reserve1) + protocolFees[token1];

        if (balance0 > expected0) {
            TransferHelper.safeTransfer(token0, to, balance0 - expected0);
        }
        if (balance1 > expected1) {
            TransferHelper.safeTransfer(token1, to, balance1 - expected1);
        }
    }

    /// @notice Collects accrued protocol fees to designated recipient; restricted to factory feeRecipient
    function collectProtocolFees(
        address recipient,
        uint256 amount0Requested,
        uint256 amount1Requested
    ) external override nonReentrant returns (uint256 amount0, uint256 amount1) {
        if (msg.sender != IOmniFiV2Factory(factory).feeRecipient()) revert Unauthorized();
        if (recipient == address(0)) revert ZeroAddress();

        uint256 fee0Available = protocolFees[token0];
        uint256 fee1Available = protocolFees[token1];

        amount0 = amount0Requested < fee0Available ? amount0Requested : fee0Available;
        amount1 = amount1Requested < fee1Available ? amount1Requested : fee1Available;

        if (amount0 > 0) {
            protocolFees[token0] = fee0Available - amount0;
            TransferHelper.safeTransfer(token0, recipient, amount0);
        }
        if (amount1 > 0) {
            protocolFees[token1] = fee1Available - amount1;
            TransferHelper.safeTransfer(token1, recipient, amount1);
        }

        emit ProtocolFeeCollected(recipient, amount0, amount1);
    }
}
