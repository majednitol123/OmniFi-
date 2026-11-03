# Operational Runbook: RB-005 Admin Multi-Sig Keyholder Rotation

## 1. Overview
This runbook governs the procedure for rotating signers, adding/removing keyholders, and updating signature threshold quorums for OmniFi multi-sig governance accounts on EVM (Gnosis Safe) and Solana (Squads Protocol).

### Triggers:
- Scheduled annual or quarterly keyholder rotation.
- Keyholder departure from organization or role change.
- Suspected compromise of a signer device or private key.

---

## 2. Requirements & Safety Constraints
- **Minimum Signer Threshold**: Never reduce threshold below $M \ge 2$.
- **Hardware Isolation**: All signers must use FIPS-certified hardware security modules or hardware wallets (Ledger Nano, Trezor, or AWS KMS).
- **Verification Rule**: Every proposed new signer address must be verified through at least two out-of-band communication channels (e.g., GPG-signed email + video verification).

---

## 3. Step-by-Step Rotation Protocol (EVM Safe)

### Step 3.1: Proposing Signer Replacement
1. Connect existing signer hardware wallet to Safe Web interface or use `@safe-global/api-kit`.
2. Navigate to Settings -> Owners -> "Add new owner" or "Replace owner".
3. Enter verified new signer address: `0xNewSignerAddress...`.
4. Maintain or update threshold (e.g., retain 3-of-5 threshold).

### Step 3.2: Signing and Execution
1. Required quorum of existing signers review transaction data hash:
   - Target Safe: `0xOmniFiAdminSafe...`
   - Method: `swapOwner(address prevOwner, address oldOwner, address newOwner)`
2. Signers inspect call parameters on hardware wallet display.
3. Once quorum threshold is satisfied, broadcast execution transaction.

### Step 3.3: On-Chain Verification
1. Inspect transaction on Etherscan / Basescan.
2. Verify event emission:
   ```solidity
   event AddedOwner(address owner);
   event RemovedOwner(address owner);
   ```
3. Run verification script:
   ```bash
   cast call <SAFE_ADDRESS> "getOwners()(address[])" --rpc-url <RPC_URL>
   ```

---

## 4. Solana Squads Protocol Rotation
1. Create proposal in Squads CLI:
   ```bash
   squads-cli proposal create --action replace-member --old-key <OLD_PUBKEY> --new-key <NEW_PUBKEY>
   ```
2. Gather signatures from current signers.
3. Execute proposal and verify updated vault member list via Solscan.

