// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { OmniFiV2Factory } from "../src/v2/OmniFiV2Factory.sol";
import { OmniFiV2Router } from "../src/v2/OmniFiV2Router.sol";
import { IOmniFiV2Pair } from "../src/interfaces/IOmniFiV2Pair.sol";
import { MockERC20 } from "../test/helpers/MockERC20.sol";

/// @title V2 Deploy Script
/// @notice Deploys OmniFi V2 Factory, Router, test tokens, and initializes a local reference pool
contract V2DeployScript is Script {
    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Anvil default key 0
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying OmniFi V2 with account:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy Factory & Router
        OmniFiV2Factory factory = new OmniFiV2Factory(deployer, deployer);
        console2.log("OmniFiV2Factory deployed at:", address(factory));

        OmniFiV2Router router = new OmniFiV2Router(address(factory));
        console2.log("OmniFiV2Router deployed at:", address(router));

        // 2. Deploy Mock Tokens
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        MockERC20 weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        console2.log("Mock USDC deployed at:", address(usdc));
        console2.log("Mock WETH deployed at:", address(weth));

        // 3. Create Pair and Add Initial Liquidity
        address pairAddress = factory.createPair(address(usdc), address(weth));
        console2.log("OmniFiV2Pair (mUSDC/mWETH) deployed at:", pairAddress);

        _seedLiquidity(router, usdc, weth, deployer);

        vm.stopBroadcast();
    }

    function _seedLiquidity(OmniFiV2Router router, MockERC20 usdc, MockERC20 weth, address deployer)
        internal
    {
        uint256 initialUsdc = 30_000_000 * 1e6; // 30M USDC
        uint256 initialWeth = 10_000 * 1e18; // 10K WETH

        usdc.mint(deployer, initialUsdc);
        weth.mint(deployer, initialWeth);

        usdc.approve(address(router), initialUsdc);
        weth.approve(address(router), initialWeth);

        (uint256 amountA, uint256 amountB, uint256 liquidity) = router.addLiquidity(
            address(usdc),
            address(weth),
            initialUsdc,
            initialWeth,
            initialUsdc,
            initialWeth,
            deployer,
            block.timestamp + 300
        );

        console2.log("Initial liquidity added:");
        console2.log("  TokenA added:", amountA);
        console2.log("  TokenB added:", amountB);
        console2.log("  LP tokens minted:", liquidity);
    }
}
