# Operational Runbook: RB-001 Emergency Protocol Pause

## 1. Overview & Triggers
This runbook defines the authoritative operational protocol for executing an emergency pause on OmniFi smart contracts across EVM (Ethereum Mainnet, Base) and Solana clusters.

### Incident Classification Triggers:
- **P0 Severity**: Active exploit attempt detected in liquidity pool logic, routing, or vault transfers.
- **P0 Severity**: Oracle manipulation / extreme flash crash arbitrage draining pool reserves.
- **P0 Severity**: Cryptographic vulnerability or critical upstream smart contract vulnerability.

---

## 2. Authorization & Roles
- **Initiator**: Security Lead, On-Call Operations Engineer, or Autonomous Sentinel.
- **Approvers**: 2-of-4 Emergency Admin Multi-Sig (EVM Safe / Solana Squads).
- **Escalation SLA**: Execution must occur within **15 minutes** of verified alert.

---

## 3. Emergency Pause Execution Steps

### Step 3.1: EVM Multi-Sig Emergency Pause
1. Navigate to the Gnosis Safe dashboard for the affected chain:
   - Ethereum Mainnet Safe: `0xAdminEmergencyEthereum...`
   - Base Safe: `0xAdminEmergencyBase...`
2. Create Transaction -> Contract Interaction:
   - Target Contract: `OmniFiRouter` or `OmniFiPool`
   - Method: `pause()` or `pausePool(bytes32 poolId)`
3. Keyholders sign with hardware wallets (Ledger/Trezor).
4. Broadcast transaction with `PriorityFee = 25 gwei` to ensure immediate next-block inclusion.
5. Verify on-chain emission of event:
   ```solidity
   event Paused(address account);
   ```

### Step 3.2: Solana Emergency Pause
1. Use Squads multi-sig CLI or UI:
   ```bash
   squads-cli tx propose --program-id Ad85ZckvQezw7n3VjYqgoXYPyV5zCsTAzrG8qMhs6La3 --instruction pause_amm
   ```
2. Gather 2 keyholder approvals.
3. Execute transaction and inspect Solana Explorer / Solscan for transaction confirmation.

### Step 3.3: Frontend Status & Circuit Quarantine
1. The frontend automatically listens to the `Paused` event or queries `GET /api/v1/pools`.
2. Update the public status page banner by triggering GitHub Actions workflow `ops-incident-banner.yml` with message:
   `"Trading temporarily halted for maintenance across affected pool pairs."`

---

## 4. Verification & Post-Pause Checklist
- [ ] Verify that all swap requests revert with `ProtocolPaused()` error.
- [ ] Verify that liquidity deposits and withdrawals revert with `ProtocolPaused()`.
- [ ] Confirm no state transitions or balance changes are occurring in affected contracts.
- [ ] Open incident bridge with Core Engineering and Security Auditors.

---

## 5. Resumption & Unpause Procedure
1. Root cause identified, fixed, and peer-reviewed by at least two independent auditors.
2. Multi-sig initiates `unpause()` proposal subject to 24-hour Timelock (unless immediate override authorized).
3. Monitor transaction metrics and pool reserves for 6 hours post-unpause.

