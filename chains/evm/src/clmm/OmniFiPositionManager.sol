// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { ERC721 } from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import { Strings } from "@openzeppelin/contracts/utils/Strings.sol";
import { Base64 } from "@openzeppelin/contracts/utils/Base64.sol";
import { IOmniFiPositionManager } from "../interfaces/IOmniFiPositionManager.sol";
import { IOmniFiMintCallback } from "../interfaces/IOmniFiMintCallback.sol";
import { IOmniFiPoolFactory } from "../interfaces/IOmniFiPoolFactory.sol";
import { IOmniFiPool } from "../interfaces/IOmniFiPool.sol";
import { LiquidityAmounts } from "./libraries/LiquidityAmounts.sol";
import { TickMath } from "./libraries/TickMath.sol";
import { FullMath } from "./libraries/FullMath.sol";
import { FixedPoint128 } from "./libraries/FixedPoint128.sol";
import { SafeCast } from "./libraries/SafeCast.sol";
import { TransferHelper } from "../v2/libraries/TransferHelper.sol";
import { Multicall } from "../periphery/Multicall.sol";

/// @title OmniFi Concentrated Liquidity Position Manager
/// @notice Wraps CLMM positions into transferable ERC-721 non-fungible tokens
contract OmniFiPositionManager is ERC721, IOmniFiPositionManager, IOmniFiMintCallback, Multicall {
    error TransactionTooOld();
    error NotAuthorized();
    error PoolDoesNotExist();
    error PriceSlippage();
    error ZeroLiquidity();
    error InsufficientLiquidity();
    error CallbackCallerNotPool();
    error PositionNotEmpty();

    address public immutable factory;
    uint256 private _nextId = 1;

    mapping(uint256 => Position) internal _positions;

    struct MintCallbackData {
        address token0;
        address token1;
        uint24 fee;
        address payer;
    }

    modifier checkDeadline(uint256 deadline) {
        if (block.timestamp > deadline) revert TransactionTooOld();
        _;
    }

    modifier isAuthorizedForToken(uint256 tokenId) {
        address tokenOwner = ownerOf(tokenId);
        if (!_isAuthorized(tokenOwner, msg.sender, tokenId)) revert NotAuthorized();
        _;
    }

    constructor(address _factory) ERC721("OmniFi Concentrated Positions", "OMNIFI-POS") {
        factory = _factory;
    }

    /// @inheritdoc IOmniFiPositionManager
    function positions(uint256 tokenId) external view override returns (Position memory) {
        return _positions[tokenId];
    }

    /// @inheritdoc IOmniFiMintCallback
    function omniFiMintCallback(uint256 amount0Owed, uint256 amount1Owed, bytes calldata data)
        external
        override
    {
        MintCallbackData memory decoded = abi.decode(data, (MintCallbackData));
        address pool =
            IOmniFiPoolFactory(factory).getPool(decoded.token0, decoded.token1, decoded.fee);
        if (msg.sender != pool) revert CallbackCallerNotPool();

        if (amount0Owed > 0) {
            TransferHelper.safeTransferFrom(decoded.token0, decoded.payer, msg.sender, amount0Owed);
        }
        if (amount1Owed > 0) {
            TransferHelper.safeTransferFrom(decoded.token1, decoded.payer, msg.sender, amount1Owed);
        }
    }

    /// @inheritdoc IOmniFiPositionManager
    function mint(MintParams calldata params)
        external
        override
        checkDeadline(params.deadline)
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        address pool = IOmniFiPoolFactory(factory).getPool(params.token0, params.token1, params.fee);
        if (pool == address(0)) revert PoolDoesNotExist();

        (uint160 sqrtPriceX96,,,) = IOmniFiPool(pool).slot0();

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(params.tickLower),
            TickMath.getSqrtPriceAtTick(params.tickUpper),
            params.amount0Desired,
            params.amount1Desired
        );

        if (liquidity == 0) revert ZeroLiquidity();

        (amount0, amount1) = IOmniFiPool(pool)
            .mint(
                address(this),
                params.tickLower,
                params.tickUpper,
                liquidity,
                abi.encode(
                    MintCallbackData({
                        token0: params.token0,
                        token1: params.token1,
                        fee: params.fee,
                        payer: msg.sender
                    })
                )
            );

        if (amount0 < params.amount0Min || amount1 < params.amount1Min) revert PriceSlippage();

        tokenId = _nextId++;
        _mint(params.recipient, tokenId);

        bytes32 positionKey =
            keccak256(abi.encodePacked(address(this), params.tickLower, params.tickUpper));
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,,) =
            IOmniFiPool(pool).positions(positionKey);

        _positions[tokenId] = Position({
            nonce: 0,
            operator: address(0),
            token0: params.token0,
            token1: params.token1,
            fee: params.fee,
            tickLower: params.tickLower,
            tickUpper: params.tickUpper,
            liquidity: liquidity,
            feeGrowthInside0LastX128: feeGrowthInside0LastX128,
            feeGrowthInside1LastX128: feeGrowthInside1LastX128,
            tokensOwed0: 0,
            tokensOwed1: 0
        });

        emit IncreaseLiquidity(tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPositionManager
    function increaseLiquidity(IncreaseLiquidityParams calldata params)
        external
        override
        isAuthorizedForToken(params.tokenId)
        checkDeadline(params.deadline)
        returns (uint128 liquidity, uint256 amount0, uint256 amount1)
    {
        Position storage pos = _positions[params.tokenId];
        address pool = IOmniFiPoolFactory(factory).getPool(pos.token0, pos.token1, pos.fee);

        (uint160 sqrtPriceX96,,,) = IOmniFiPool(pool).slot0();

        liquidity = LiquidityAmounts.getLiquidityForAmounts(
            sqrtPriceX96,
            TickMath.getSqrtPriceAtTick(pos.tickLower),
            TickMath.getSqrtPriceAtTick(pos.tickUpper),
            params.amount0Desired,
            params.amount1Desired
        );

        if (liquidity == 0) revert ZeroLiquidity();

        (amount0, amount1) = IOmniFiPool(pool)
            .mint(
                address(this),
                pos.tickLower,
                pos.tickUpper,
                liquidity,
                abi.encode(
                    MintCallbackData({
                        token0: pos.token0, token1: pos.token1, fee: pos.fee, payer: msg.sender
                    })
                )
            );

        if (amount0 < params.amount0Min || amount1 < params.amount1Min) revert PriceSlippage();

        bytes32 positionKey =
            keccak256(abi.encodePacked(address(this), pos.tickLower, pos.tickUpper));
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,,) =
            IOmniFiPool(pool).positions(positionKey);

        pos.tokensOwed0 += uint128(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - pos.feeGrowthInside0LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );
        pos.tokensOwed1 += uint128(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - pos.feeGrowthInside1LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );

        pos.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        pos.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        pos.liquidity += liquidity;

        emit IncreaseLiquidity(params.tokenId, liquidity, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPositionManager
    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        override
        isAuthorizedForToken(params.tokenId)
        checkDeadline(params.deadline)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = _positions[params.tokenId];
        if (pos.liquidity < params.liquidity) revert InsufficientLiquidity();

        address pool = IOmniFiPoolFactory(factory).getPool(pos.token0, pos.token1, pos.fee);

        (amount0, amount1) = IOmniFiPool(pool).burn(pos.tickLower, pos.tickUpper, params.liquidity);

        if (amount0 < params.amount0Min || amount1 < params.amount1Min) revert PriceSlippage();

        bytes32 positionKey =
            keccak256(abi.encodePacked(address(this), pos.tickLower, pos.tickUpper));
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,,) =
            IOmniFiPool(pool).positions(positionKey);

        pos.tokensOwed0 += uint128(amount0)
        + uint128(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - pos.feeGrowthInside0LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );
        pos.tokensOwed1 += uint128(amount1)
        + uint128(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - pos.feeGrowthInside1LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );

        pos.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        pos.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;
        pos.liquidity -= params.liquidity;

        emit DecreaseLiquidity(params.tokenId, params.liquidity, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPositionManager
    function collect(CollectParams calldata params)
        external
        override
        isAuthorizedForToken(params.tokenId)
        returns (uint256 amount0, uint256 amount1)
    {
        Position storage pos = _positions[params.tokenId];
        address pool = IOmniFiPoolFactory(factory).getPool(pos.token0, pos.token1, pos.fee);

        bytes32 positionKey =
            keccak256(abi.encodePacked(address(this), pos.tickLower, pos.tickUpper));
        (, uint256 feeGrowthInside0LastX128, uint256 feeGrowthInside1LastX128,,) =
            IOmniFiPool(pool).positions(positionKey);

        pos.tokensOwed0 += uint128(
            FullMath.mulDiv(
                feeGrowthInside0LastX128 - pos.feeGrowthInside0LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );
        pos.tokensOwed1 += uint128(
            FullMath.mulDiv(
                feeGrowthInside1LastX128 - pos.feeGrowthInside1LastX128,
                pos.liquidity,
                FixedPoint128.Q128
            )
        );

        pos.feeGrowthInside0LastX128 = feeGrowthInside0LastX128;
        pos.feeGrowthInside1LastX128 = feeGrowthInside1LastX128;

        uint128 amount0Collect =
            params.amount0Max > pos.tokensOwed0 ? pos.tokensOwed0 : params.amount0Max;
        uint128 amount1Collect =
            params.amount1Max > pos.tokensOwed1 ? pos.tokensOwed1 : params.amount1Max;

        (amount0, amount1) = IOmniFiPool(pool)
            .collect(params.recipient, pos.tickLower, pos.tickUpper, amount0Collect, amount1Collect);

        pos.tokensOwed0 -= SafeCast.toUint128(amount0);
        pos.tokensOwed1 -= SafeCast.toUint128(amount1);

        emit Collect(params.tokenId, params.recipient, amount0, amount1);
    }

    /// @inheritdoc IOmniFiPositionManager
    function burn(uint256 tokenId) external override isAuthorizedForToken(tokenId) {
        Position storage pos = _positions[tokenId];
        if (pos.liquidity != 0 || pos.tokensOwed0 != 0 || pos.tokensOwed1 != 0) {
            revert PositionNotEmpty();
        }

        _burn(tokenId);
        delete _positions[tokenId];
    }

    /// @notice Returns standard dynamic on-chain metadata URI for the position NFT
    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        _requireOwned(tokenId);
        Position memory pos = _positions[tokenId];

        string memory json = Base64.encode(
            bytes(
                string.concat(
                    '{"name":"OmniFi CLMM Position #',
                    Strings.toString(tokenId),
                    '","description":"OmniFi Concentrated Liquidity Position NFT representing pooled assets in range.',
                    '","attributes":[{"trait_type":"Fee Tier","value":"',
                    Strings.toString(pos.fee),
                    '"},{"trait_type":"Tick Lower","value":"',
                    Strings.toStringSigned(int256(pos.tickLower)),
                    '"},{"trait_type":"Tick Upper","value":"',
                    Strings.toStringSigned(int256(pos.tickUpper)),
                    '"},{"trait_type":"Liquidity","value":"',
                    Strings.toString(pos.liquidity),
                    '"}]}'
                )
            )
        );

        return string.concat("data:application/json;base64,", json);
    }
}
