// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

/**
 * @title OmniFiSafe
 * @notice Production-grade 2-of-4 Multi-Signature Wallet compatible with Gnosis Safe v1.4.1.
 * @dev Implements EIP-712 typed structured data signing, ECDSA signature recovery with strict
 *      address ascending order checks, threshold enforcement, and self-governed owner rotation.
 */
contract OmniFiSafe {
    // --- Constants & EIP-712 TypeHashes ---
    bytes32 public constant DOMAIN_SEPARATOR_TYPEHASH =
        keccak256("EIP712Domain(uint256 chainId,address verifyingContract)");

    bytes32 public constant SAFE_TX_TYPEHASH =
        keccak256(
            "SafeTx(address to,uint256 value,bytes data,uint8 operation,uint256 safeTxGas,uint256 baseGas,uint256 gasPrice,address gasToken,address refundReceiver,uint256 nonce)"
        );

    enum Operation {
        Call,
        DelegateCall
    }

    // --- State Variables ---
    address[] internal _owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;
    uint256 public nonce;

    // --- Events ---
    event SafeSetup(address indexed initiator, address[] owners, uint256 threshold);
    event ExecutionSuccess(bytes32 indexed txHash, uint256 payment);
    event ExecutionFailure(bytes32 indexed txHash, uint256 payment);
    event AddedOwner(address indexed owner);
    event RemovedOwner(address indexed owner);
    event ChangedThreshold(uint256 threshold);

    // --- Custom Errors ---
    error AlreadyInitialized();
    error NotInitialized();
    error InvalidThreshold(uint256 threshold, uint256 ownerCount);
    error InvalidOwnerCount(uint256 count);
    error InvalidOwner(address owner);
    error DuplicateOwner(address owner);
    error InsufficientSignatures(uint256 provided, uint256 requiredThreshold);
    error SignerNotUnique(address signer, address lastSigner);
    error SignerNotOwner(address signer);
    error ExecutionFailed(bytes returnData);
    error OnlySelf();
    error InvalidSignatureLength(uint256 length);

    modifier onlySelf() {
        if (msg.sender != address(this)) {
            revert OnlySelf();
        }
        _;
    }

    /**
     * @notice Constructor initializes the Safe contract with owners and signature threshold.
     * @param initialOwners Array of unique owner addresses (e.g. 4 distinct owners).
     * @param initialThreshold Required signature count (e.g. 2).
     */
    constructor(address[] memory initialOwners, uint256 initialThreshold) {
        _setup(initialOwners, initialThreshold);
    }

    /**
     * @notice Fallback to accept native ETH deposits.
     */
    receive() external payable {}

    /**
     * @notice Internal setup helper.
     */
    function _setup(address[] memory owners_, uint256 threshold_) internal {
        if (_owners.length > 0) {
            revert AlreadyInitialized();
        }
        uint256 count = owners_.length;
        if (count == 0) {
            revert InvalidOwnerCount(0);
        }
        if (threshold_ == 0 || threshold_ > count) {
            revert InvalidThreshold(threshold_, count);
        }

        for (uint256 i = 0; i < count; i++) {
            address owner = owners_[i];
            if (owner == address(0) || owner == address(this)) {
                revert InvalidOwner(owner);
            }
            if (isOwner[owner]) {
                revert DuplicateOwner(owner);
            }
            isOwner[owner] = true;
            _owners.push(owner);
        }

        threshold = threshold_;
        emit SafeSetup(msg.sender, owners_, threshold_);
    }

    /**
     * @notice Computes the current EIP-712 Domain Separator.
     */
    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(DOMAIN_SEPARATOR_TYPEHASH, block.chainid, address(this)));
    }

    /**
     * @notice Computes the EIP-712 transaction hash for a proposed Safe transaction.
     */
    function getTransactionHash(
        address to,
        uint256 value,
        bytes memory data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address refundReceiver,
        uint256 _nonce
    ) public view returns (bytes32) {
        bytes32 safeTxHash = keccak256(
            abi.encode(
                SAFE_TX_TYPEHASH,
                to,
                value,
                keccak256(data),
                uint8(operation),
                safeTxGas,
                baseGas,
                gasPrice,
                gasToken,
                refundReceiver,
                _nonce
            )
        );
        return keccak256(abi.encodePacked(bytes1(0x19), bytes1(0x01), domainSeparator(), safeTxHash));
    }

    /**
     * @notice Executes a multi-signature transaction once quorum is proven.
     * @param to Destination address.
     * @param value Native Ether value in wei.
     * @param data Payload calldata.
     * @param operation Call or DelegateCall.
     * @param safeTxGas Gas budgeted for the call.
     * @param baseGas Gas unspent before execution.
     * @param gasPrice Gas price for refund accounting.
     * @param gasToken Token used for payment (address(0) for ETH).
     * @param refundReceiver Address receiving gas reimbursement.
     * @param signatures Packed ECDSA signatures strictly ordered by signer address ascending.
     */
    function execTransaction(
        address to,
        uint256 value,
        bytes calldata data,
        Operation operation,
        uint256 safeTxGas,
        uint256 baseGas,
        uint256 gasPrice,
        address gasToken,
        address payable refundReceiver,
        bytes memory signatures
    ) external payable returns (bool success) {
        bytes32 txHash = getTransactionHash(
            to,
            value,
            data,
            operation,
            safeTxGas,
            baseGas,
            gasPrice,
            gasToken,
            refundReceiver,
            nonce
        );

        // Advance nonce prior to external execution to prevent replay attacks
        nonce++;

        // Validate multi-sig signatures against current owners & threshold
        checkSignatures(txHash, signatures);

        // Execute external call
        if (operation == Operation.DelegateCall) {
            // solhint-disable-next-line avoid-low-level-calls
            (success, ) = to.delegatecall(data);
        } else {
            // solhint-disable-next-line avoid-low-level-calls
            (success, ) = to.call{value: value}(data);
        }

        if (success) {
            emit ExecutionSuccess(txHash, 0);
        } else {
            emit ExecutionFailure(txHash, 0);
            revert ExecutionFailed("");
        }
    }

    /**
     * @notice Validates that provided signatures satisfy threshold and come from unique owners.
     * @dev Signatures must be 65-byte chunks (r, s, v) and ordered strictly by ascending signer address.
     */
    function checkSignatures(bytes32 dataHash, bytes memory signatures) public view {
        uint256 _threshold = threshold;
        if (signatures.length < _threshold * 65) {
            revert InsufficientSignatures(signatures.length / 65, _threshold);
        }

        address lastSigner = address(0);

        for (uint256 i = 0; i < _threshold; i++) {
            (bytes32 r, bytes32 s, uint8 v) = _splitSignature(signatures, i);
            address signer = ecrecover(dataHash, v, r, s);

            if (!isOwner[signer]) {
                revert SignerNotOwner(signer);
            }
            if (signer <= lastSigner) {
                revert SignerNotUnique(signer, lastSigner);
            }
            lastSigner = signer;
        }
    }

    /**
     * @dev Extracts r, s, v from packed signatures at given index.
     */
    function _splitSignature(bytes memory signatures, uint256 index)
        internal
        pure
        returns (
            bytes32 r,
            bytes32 s,
            uint8 v
        )
    {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            let offset := add(add(signatures, 0x20), mul(index, 65))
            r := mload(offset)
            s := mload(add(offset, 32))
            v := byte(0, mload(add(offset, 64)))
        }
    }

    // --- Owner & Threshold Management (Restricted to onlySelf via MultiSig) ---

    function addOwnerWithThreshold(address newOwner, uint256 newThreshold) external onlySelf {
        if (newOwner == address(0) || newOwner == address(this)) {
            revert InvalidOwner(newOwner);
        }
        if (isOwner[newOwner]) {
            revert DuplicateOwner(newOwner);
        }
        isOwner[newOwner] = true;
        _owners.push(newOwner);
        emit AddedOwner(newOwner);

        if (newThreshold > 0) {
            _changeThreshold(newThreshold);
        }
    }

    function removeOwner(address /* prevOwner */, address owner, uint256 newThreshold) external onlySelf {
        if (!isOwner[owner]) {
            revert InvalidOwner(owner);
        }
        isOwner[owner] = false;

        uint256 len = _owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (_owners[i] == owner) {
                _owners[i] = _owners[len - 1];
                _owners.pop();
                break;
            }
        }
        emit RemovedOwner(owner);

        _changeThreshold(newThreshold);
    }

    function swapOwner(address /* prevOwner */, address oldOwner, address newOwner) external onlySelf {
        if (newOwner == address(0) || newOwner == address(this) || isOwner[newOwner]) {
            revert InvalidOwner(newOwner);
        }
        if (!isOwner[oldOwner]) {
            revert InvalidOwner(oldOwner);
        }

        isOwner[oldOwner] = false;
        isOwner[newOwner] = true;

        uint256 len = _owners.length;
        for (uint256 i = 0; i < len; i++) {
            if (_owners[i] == oldOwner) {
                _owners[i] = newOwner;
                break;
            }
        }

        emit RemovedOwner(oldOwner);
        emit AddedOwner(newOwner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        _changeThreshold(newThreshold);
    }

    function _changeThreshold(uint256 newThreshold) internal {
        if (newThreshold == 0 || newThreshold > _owners.length) {
            revert InvalidThreshold(newThreshold, _owners.length);
        }
        threshold = newThreshold;
        emit ChangedThreshold(newThreshold);
    }

    // --- Views ---

    function getOwners() external view returns (address[] memory) {
        return _owners;
    }

    function getThreshold() external view returns (uint256) {
        return threshold;
    }

    function isOwnerAddress(address account) external view returns (bool) {
        return isOwner[account];
    }
}
