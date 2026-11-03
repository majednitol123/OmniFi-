// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { OmniFiPoolFactory } from "../src/clmm/OmniFiPoolFactory.sol";
import { OmniFiPositionManager } from "../src/clmm/OmniFiPositionManager.sol";
import { OmniFiSwapRouter } from "../src/clmm/OmniFiSwapRouter.sol";
import { OmniFiQuoter } from "../src/clmm/OmniFiQuoter.sol";
import { IOmniFiPool } from "../src/interfaces/IOmniFiPool.sol";
import { IOmniFiPositionManager } from "../src/interfaces/IOmniFiPositionManager.sol";
import { TickMath } from "../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../test/helpers/MockERC20.sol";

/// @title CLMM Deploy Script
/// @notice Deploys OmniFi CLMM Factory, Position Manager, Swap Router, Quoter, and sets up a reference pool
contract CLMMDeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Anvil default key 0
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying OmniFi CLMM with account:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Factory, Position Manager, Router, and Quoter
        OmniFiPoolFactory factory = new OmniFiPoolFactory(deployer, deployer);
        console2.log("OmniFiPoolFactory deployed at:", address(factory));

        OmniFiPositionManager posManager = new OmniFiPositionManager(address(factory));
        console2.log("OmniFiPositionManager deployed at:", address(posManager));

        OmniFiSwapRouter router = new OmniFiSwapRouter(address(factory));
        console2.log("OmniFiSwapRouter deployed at:", address(router));

        OmniFiQuoter quoter = new OmniFiQuoter(address(factory));
        console2.log("OmniFiQuoter deployed at:", address(quoter));

        // 2. Deploy Mock Tokens
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        MockERC20 weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        console2.log("Mock USDC deployed at:", address(usdc));
        console2.log("Mock WETH deployed at:", address(weth));

        // Determine token0 and token1 order
        (address token0, address token1) = address(usdc) < address(weth)
            ? (address(usdc), address(weth))
            : (address(weth), address(usdc));

        // 3. Create 0.30% Fee Pool (tick spacing 60)
        address poolAddress = factory.createPool(token0, token1, 3000);
        console2.log("OmniFiPool (0.30% fee) created at:", poolAddress);

        // 4. Initialize Pool Price to Parity (tick 0)
        IOmniFiPool pool = IOmniFiPool(poolAddress);
        pool.initialize(TickMath.getSqrtPriceAtTick(0));
        console2.log("Pool initialized at tick 0 (parity)");

        // 5. Seed Initial Concentrated Liquidity via Position Manager
        _seedLiquidity(posManager, token0, token1, deployer);

        vm.stopBroadcast();
    }

    function _seedLiquidity(
        OmniFiPositionManager posManager,
        address token0,
        address token1,
        address deployer
    ) internal {
        uint256 amount0Desired = 100_000 ether;
        uint256 amount1Desired = 100_000 ether;

        MockERC20(token0).mint(deployer, amount0Desired);
        MockERC20(token1).mint(deployer, amount1Desired);

        MockERC20(token0).approve(address(posManager), amount0Desired);
        MockERC20(token1).approve(address(posManager), amount1Desired);

        (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1) = posManager.mint(
            IOmniFiPositionManager.MintParams({
                token0: token0,
                token1: token1,
                fee: 3000,
                tickLower: -1200,
                tickUpper: 1200,
                amount0Desired: amount0Desired,
                amount1Desired: amount1Desired,
                amount0Min: 0,
                amount1Min: 0,
                recipient: deployer,
                deadline: block.timestamp + 300
            })
        );

        console2.log("Initial concentrated liquidity seeded:");
        console2.log("  Position NFT Token ID:", tokenId);
        console2.log("  Liquidity minted:", liquidity);
        console2.log("  Token0 deposited:", amount0);
        console2.log("  Token1 deposited:", amount1);
    }
}

