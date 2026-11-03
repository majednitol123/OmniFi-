// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import { IWETH9 } from "../../src/interfaces/IWETH9.sol";

/// @title MockWETH9
/// @notice Canonical WETH9 mock implementation for periphery and router tests
contract MockWETH9 is IWETH9 {
    string public override name = "Wrapped Ether";
    string public override symbol = "WETH";
    uint8 public override decimals = 18;

    mapping(address => uint256) public override balanceOf;
    mapping(address => mapping(address => uint256)) public override allowance;

    uint256 public override totalSupply;

    error InsufficientBalance();
    error InsufficientAllowance();

    receive() external payable {
        deposit();
    }

    function deposit() public payable override {
        balanceOf[msg.sender] += msg.value;
        totalSupply += msg.value;
        emit Transfer(address(0), msg.sender, msg.value);
    }

    function withdraw(uint256 wad) public override {
        if (balanceOf[msg.sender] < wad) revert InsufficientBalance();
        balanceOf[msg.sender] -= wad;
        totalSupply -= wad;
        (bool success,) = msg.sender.call{value: wad}("");
        require(success, "WETH: ETH transfer failed");
        emit Transfer(msg.sender, address(0), wad);
    }

    function approve(address spender, uint256 value) external override returns (bool) {
        allowance[msg.sender][spender] = value;
        emit Approval(msg.sender, spender, value);
        return true;
    }

    function transfer(address to, uint256 value) external override returns (bool) {
        return transferFrom(msg.sender, to, value);
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (from != msg.sender) {
            uint256 currentAllowance = allowance[from][msg.sender];
            if (currentAllowance < value) revert InsufficientAllowance();
            if (currentAllowance != type(uint256).max) {
                allowance[from][msg.sender] = currentAllowance - value;
            }
        }

        if (balanceOf[from] < value) revert InsufficientBalance();
        balanceOf[from] -= value;
        balanceOf[to] += value;

        emit Transfer(from, to, value);
        return true;
    }
}

