// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Test } from "forge-std/Test.sol";
import { OmniFiV2Factory } from "../../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Pair } from "../../src/v2/OmniFiV2Pair.sol";
import { OmniFiV2Library } from "../../src/v2/libraries/OmniFiV2Library.sol";
import { MockERC20 } from "../helpers/MockERC20.sol";

contract OmniFiV2Handler is Test {
    OmniFiV2Pair public pair;
    MockERC20 public token0;
    MockERC20 public token1;

    uint256 public kBefore;
    uint256 public lastSwapKAfter;

    constructor(OmniFiV2Pair pair_, MockERC20 token0_, MockERC20 token1_) {
        pair = pair_;
        token0 = token0_;
        token1 = token1_;
    }

    function swap0For1(uint256 amountInRaw) public {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        if (r0 <= 2000 || r1 <= 2000) return;

        uint256 maxIn = uint256(r0) / 2;
        if (maxIn < 1000) return;

        // Bound amountIn between 1000 and r0 / 2 (prevent 100% drain and zero output)
        uint256 amountIn = bound(amountInRaw, 1000, maxIn);
        if (amountIn == 0) return;

        uint256 amountInAfterFee = (amountIn * 997000) / 1000000;
        if (amountInAfterFee == 0 || (uint256(r1) * amountInAfterFee) < (uint256(r0) + amountInAfterFee)) return;

        uint256 expectedOut = OmniFiV2Library.getAmountOut(amountIn, r0, r1, 3000);
        if (expectedOut == 0 || expectedOut >= r1) return;

        token0.mint(address(pair), amountIn);

        kBefore = uint256(r0) * r1;
        pair.swap(0, expectedOut, address(this), new bytes(0));

        (uint112 r0After, uint112 r1After,) = pair.getReserves();
        lastSwapKAfter = uint256(r0After) * r1After;
    }

    function swap1For0(uint256 amountInRaw) public {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        if (r0 <= 2000 || r1 <= 2000) return;

        uint256 maxIn = uint256(r1) / 2;
        if (maxIn < 1000) return;

        // Bound amountIn between 1000 and r1 / 2 (prevent 100% drain and zero output)
        uint256 amountIn = bound(amountInRaw, 1000, maxIn);
        if (amountIn == 0) return;

        uint256 amountInAfterFee = (amountIn * 997000) / 1000000;
        if (amountInAfterFee == 0 || (uint256(r0) * amountInAfterFee) < (uint256(r1) + amountInAfterFee)) return;

        uint256 expectedOut = OmniFiV2Library.getAmountOut(amountIn, r1, r0, 3000);
        if (expectedOut == 0 || expectedOut >= r0) return;

        token1.mint(address(pair), amountIn);

        kBefore = uint256(r0) * r1;
        pair.swap(expectedOut, 0, address(this), new bytes(0));

        (uint112 r0After, uint112 r1After,) = pair.getReserves();
        lastSwapKAfter = uint256(r0After) * r1After;
    }
}

contract OmniFiV2InvariantTest is Test {
    OmniFiV2Factory internal factory;
    OmniFiV2Pair internal pair;
    MockERC20 internal token0;
    MockERC20 internal token1;
    OmniFiV2Handler internal handler;

    function setUp() public {
        factory = new OmniFiV2Factory(address(this), address(0xBB));
        MockERC20 tokenA = new MockERC20("Token A", "TKNA", 18);
        MockERC20 tokenB = new MockERC20("Token B", "TKNB", 18);

        address pairAddress = factory.createPair(address(tokenA), address(tokenB));
        pair = OmniFiV2Pair(pairAddress);

        token0 = MockERC20(pair.token0());
        token1 = MockERC20(pair.token1());

        // Initial deposit
        token0.mint(address(pair), 1_000_000 ether);
        token1.mint(address(pair), 1_000_000 ether);
        pair.mint(address(this));

        handler = new OmniFiV2Handler(pair, token0, token1);

        targetContract(address(handler));
    }

    /// @notice Invariant: k never decreases after swaps
    function invariant_kNeverDecreases() public view {
        if (handler.kBefore() > 0) {
            assertGe(
                handler.lastSwapKAfter(),
                handler.kBefore(),
                "Invariant violated: k decreased after swap"
            );
        }
    }

    /// @notice Invariant: pool token balance >= reserve + protocolFees
    function invariant_reservesMatchBalances() public view {
        (uint112 r0, uint112 r1,) = pair.getReserves();
        uint256 bal0 = token0.balanceOf(address(pair));
        uint256 bal1 = token1.balanceOf(address(pair));
        uint256 fee0 = pair.protocolFees(address(token0));
        uint256 fee1 = pair.protocolFees(address(token1));

        assertGe(bal0, uint256(r0) + fee0, "Invariant violated: balance0 < reserve0 + fee0");
        assertGe(bal1, uint256(r1) + fee1, "Invariant violated: balance1 < reserve1 + fee1");
    }

    /// @notice Invariant: totalSupply >= 1000 (minimum liquidity locked forever)
    function invariant_minimumLiquidityPermanentlyLocked() public view {
        assertGe(pair.totalSupply(), 1000, "Invariant violated: totalSupply < MINIMUM_LIQUIDITY");
        assertEq(pair.balanceOf(address(0)), 1000, "Invariant violated: address(0) balance != 1000");
    }
}
