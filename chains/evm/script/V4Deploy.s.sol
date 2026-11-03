// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { Script, console2 } from "forge-std/Script.sol";
import { OmniFiPoolManager } from "../src/v4-core/OmniFiPoolManager.sol";
import { Currency, CurrencyLibrary } from "../src/v4-core/types/Currency.sol";
import { PoolKey } from "../src/v4-core/types/PoolKey.sol";
import { PoolId, PoolIdLibrary } from "../src/v4-core/types/PoolId.sol";
import { TickMath } from "../src/clmm/libraries/TickMath.sol";
import { MockERC20 } from "../test/helpers/MockERC20.sol";
import { UnlockRouter } from "../test/helpers/UnlockRouter.sol";

/// @title V4 Deploy Script
/// @notice Deploys OmniFiPoolManager, reference UnlockRouter, and initializes a local reference pool
contract V4DeployScript is Script {
    using PoolIdLibrary for PoolKey;

    function run() external {
        uint256 deployerPrivateKey = vm.envOr(
            "PRIVATE_KEY",
            uint256(0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80) // Anvil default key 0
        );
        address deployer = vm.addr(deployerPrivateKey);

        console2.log("Deploying OmniFi v4 Singleton with account:", deployer);

        vm.startBroadcast(deployerPrivateKey);

        // 1. Deploy PoolManager
        OmniFiPoolManager manager = new OmniFiPoolManager(deployer, deployer);
        console2.log("OmniFiPoolManager deployed at:", address(manager));

        // 2. Deploy reference UnlockRouter
        UnlockRouter router = new UnlockRouter(address(manager));
        console2.log("UnlockRouter deployed at:", address(router));

        // 3. Deploy Mock Tokens
        MockERC20 usdc = new MockERC20("Mock USD Coin", "mUSDC", 6);
        MockERC20 weth = new MockERC20("Mock Wrapped Ether", "mWETH", 18);
        console2.log("Mock USDC deployed at:", address(usdc));
        console2.log("Mock WETH deployed at:", address(weth));

        // 4. Canonical Currency Sort
        address addrUsdc = address(usdc);
        address addrWeth = address(weth);
        Currency c0;
        Currency c1;

        if (addrUsdc < addrWeth) {
            c0 = Currency.wrap(addrUsdc);
            c1 = Currency.wrap(addrWeth);
        } else {
            c0 = Currency.wrap(addrWeth);
            c1 = Currency.wrap(addrUsdc);
        }

        // 5. Initialize Pool
        PoolKey memory key = PoolKey({
            currency0: c0, currency1: c1, fee: 3000, tickSpacing: 60, hooks: address(0)
        });

        int24 initialTick = manager.initialize(key, TickMath.getSqrtPriceAtTick(0));
        console2.log("Pool initialized with PoolId:", vm.toString(PoolId.unwrap(key.toId())));
        console2.log("Initial tick:", initialTick);

        vm.stopBroadcast();
    }
}
