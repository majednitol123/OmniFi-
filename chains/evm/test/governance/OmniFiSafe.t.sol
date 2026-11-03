// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Test} from "forge-std/Test.sol";
import {OmniFiSafe} from "../../src/governance/OmniFiSafe.sol";

contract MockGovernanceTarget {
    uint256 public value;
    address public lastCaller;

    function setValue(uint256 _value) external payable {
        value = _value;
        lastCaller = msg.sender;
    }

    function failingCall() external pure {
        revert("TargetFailed()");
    }
}

contract OmniFiSafeTest is Test {
    OmniFiSafe public safe;
    MockGovernanceTarget public target;

    uint256 internal owner1Pk = 0x101;
    uint256 internal owner2Pk = 0x102;
    uint256 internal owner3Pk = 0x103;
    uint256 internal owner4Pk = 0x104;
    uint256 internal nonOwnerPk = 0x999;

    address internal owner1;
    address internal owner2;
    address internal owner3;
    address internal owner4;
    address internal nonOwner;

    function setUp() public {
        owner1 = vm.addr(owner1Pk);
        owner2 = vm.addr(owner2Pk);
        owner3 = vm.addr(owner3Pk);
        owner4 = vm.addr(owner4Pk);
        nonOwner = vm.addr(nonOwnerPk);

        // Sort owner addresses ascending to guarantee canonical ordering
        address[4] memory tempOwners = [owner1, owner2, owner3, owner4];
        for (uint256 i = 0; i < 4; i++) {
            for (uint256 j = i + 1; j < 4; j++) {
                if (tempOwners[i] > tempOwners[j]) {
                    address tmp = tempOwners[i];
                    tempOwners[i] = tempOwners[j];
                    tempOwners[j] = tmp;
                }
            }
        }

        address[] memory owners = new address[](4);
        owners[0] = tempOwners[0];
        owners[1] = tempOwners[1];
        owners[2] = tempOwners[2];
        owners[3] = tempOwners[3];

        safe = new OmniFiSafe(owners, 2);
        target = new MockGovernanceTarget();

        vm.deal(address(safe), 10 ether);
        vm.deal(address(this), 10 ether);
    }

    function _signHash(uint256 pk, bytes32 txHash) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, txHash);
        return abi.encodePacked(r, s, v);
    }

    function _concatSignatures(uint256 pkA, uint256 pkB, bytes32 txHash) internal pure returns (bytes memory) {
        address addrA = vm.addr(pkA);
        address addrB = vm.addr(pkB);

        // Safe requires signatures sorted strictly ascending by signer address
        if (addrA > addrB) {
            uint256 tmpPk = pkA;
            pkA = pkB;
            pkB = tmpPk;
        }

        bytes memory sigA = _signHash(pkA, txHash);
        bytes memory sigB = _signHash(pkB, txHash);
        return abi.encodePacked(sigA, sigB);
    }

    // 1. Initial Setup Verification
    function test_Safe_InitialSetup_2of4() public view {
        assertEq(safe.threshold(), 2);
        assertEq(safe.nonce(), 0);
        address[] memory owners = safe.getOwners();
        assertEq(owners.length, 4);
        assertTrue(safe.isOwnerAddress(owner1));
        assertTrue(safe.isOwnerAddress(owner2));
        assertTrue(safe.isOwnerAddress(owner3));
        assertTrue(safe.isOwnerAddress(owner4));
        assertFalse(safe.isOwnerAddress(nonOwner));
    }

    // 2. Successful Execution with 2-of-4 Signatures
    function test_Safe_ExecTransaction_2of4_Success() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 42);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory signatures = _concatSignatures(owner1Pk, owner2Pk, txHash);

        bool success = safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );

        assertTrue(success);
        assertEq(target.value(), 42);
        assertEq(target.lastCaller(), address(safe));
        assertEq(safe.nonce(), 1);
    }

    // 3. Execution with ETH Transfer
    function test_Safe_ExecTransaction_ETHTransfer_Success() public {
        address recipient = address(0xCAFE);
        uint256 prevBalance = recipient.balance;

        bytes32 txHash = safe.getTransactionHash(
            recipient,
            1 ether,
            "",
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory signatures = _concatSignatures(owner2Pk, owner3Pk, txHash);

        safe.execTransaction(
            recipient,
            1 ether,
            "",
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );

        assertEq(recipient.balance, prevBalance + 1 ether);
        assertEq(safe.nonce(), 1);
    }

    // 4. Reverts on 1-of-4 Signature (Insufficient Quorum)
    function test_Safe_ExecTransaction_1of4_Reverts() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 99);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory singleSig = _signHash(owner1Pk, txHash);

        vm.expectRevert(abi.encodeWithSelector(OmniFiSafe.InsufficientSignatures.selector, 1, 2));
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            singleSig
        );
    }

    // 5. Reverts on Duplicate Signature (Same Owner Twice)
    function test_Safe_ExecTransaction_DuplicateSigner_Reverts() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 100);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory sig = _signHash(owner1Pk, txHash);
        bytes memory duplicateSigs = abi.encodePacked(sig, sig);

        vm.expectRevert();
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            duplicateSigs
        );
    }

    // 6. Reverts on Non-Owner Signature
    function test_Safe_ExecTransaction_NonOwner_Reverts() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 100);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory sigs = _concatSignatures(owner1Pk, nonOwnerPk, txHash);

        vm.expectRevert(abi.encodeWithSelector(OmniFiSafe.SignerNotOwner.selector, nonOwner));
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            sigs
        );
    }

    // 7. Reverts on Unsorted Signatures
    function test_Safe_ExecTransaction_Unsorted_Reverts() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 100);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        address addr1 = vm.addr(owner1Pk);
        address addr2 = vm.addr(owner2Pk);

        uint256 highPk = addr1 > addr2 ? owner1Pk : owner2Pk;
        uint256 lowPk = addr1 > addr2 ? owner2Pk : owner1Pk;

        // Force incorrect high-to-low ordering
        bytes memory unsortedSigs = abi.encodePacked(_signHash(highPk, txHash), _signHash(lowPk, txHash));

        vm.expectRevert();
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            unsortedSigs
        );
    }

    // 8. Reverts on Replay Attack (Reusing Nonce)
    function test_Safe_ReplayAttack_Reverts() public {
        bytes memory data = abi.encodeWithSelector(MockGovernanceTarget.setValue.selector, 77);
        bytes32 txHash = safe.getTransactionHash(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory signatures = _concatSignatures(owner1Pk, owner3Pk, txHash);

        // First execution succeeds
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );

        // Replaying with now-incremented nonce must revert because signatures were computed for nonce=0
        vm.expectRevert();
        safe.execTransaction(
            address(target),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );
    }

    // 9. Swap Owner via 2-of-4 MultiSig
    function test_Safe_SwapOwner_ViaMultisig() public {
        address newOwner = address(0x8888);
        bytes memory data = abi.encodeWithSelector(
            OmniFiSafe.swapOwner.selector,
            address(0),
            owner4,
            newOwner
        );

        bytes32 txHash = safe.getTransactionHash(
            address(safe),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory signatures = _concatSignatures(owner1Pk, owner2Pk, txHash);

        safe.execTransaction(
            address(safe),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );

        assertFalse(safe.isOwnerAddress(owner4));
        assertTrue(safe.isOwnerAddress(newOwner));
    }

    // 10. Change Threshold via 2-of-4 MultiSig
    function test_Safe_ChangeThreshold_ViaMultisig() public {
        bytes memory data = abi.encodeWithSelector(OmniFiSafe.changeThreshold.selector, 3);
        bytes32 txHash = safe.getTransactionHash(
            address(safe),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            address(0),
            0
        );

        bytes memory signatures = _concatSignatures(owner1Pk, owner2Pk, txHash);

        safe.execTransaction(
            address(safe),
            0,
            data,
            OmniFiSafe.Operation.Call,
            0,
            0,
            0,
            address(0),
            payable(address(0)),
            signatures
        );

        assertEq(safe.threshold(), 3);
    }
}

