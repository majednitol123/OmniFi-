# OmniFi — Solana Native Constant-Product AMM Deployment & Operational Guide

## Overview

The OmniFi Solana AMM is an independent, native implementation of a constant-product Automated Market Maker ($x \cdot y \ge k$) designed specifically for the Solana runtime. It uses deterministic Program Derived Addresses (PDAs) for pool discovery, authority isolation, and vault custody, targeting Solana Devnet and Localnet.

Per **ADR-005** and **ADR-008**, the Solana AMM is a clean-room implementation with PDA-backed token vaults, off-curve programmatic authorities, and pure integer arithmetic (`u64` / `u128`).

---

## Program Architecture

```
                                  +------------------------------------+
                                  |            GlobalConfig            |
                                  |   PDA: ["omnifi-config"]           |
                                  |   - Protocol fee fraction (0-25%)  |
                                  |   - Emergency pause switch         |
                                  +------------------------------------+
                                                    |
                                                    v
+------------------------------------+    +------------------------------------+
|             User / SDK             |--->|             PoolState              |
|   - SDK: @omnifi/sdk-solana        |    |   PDA: ["omnifi-pool", m0, m1, fee]|
|   - Deterministic PDA derivation   |    |   - Reserve 0 & Reserve 1          |
|   - ExactInput / ExactOutput swaps |    |   - LP mint & LP supply            |
+------------------------------------+    |   - Accumulated protocol fees      |
                                          +------------------------------------+
                                                    |
                                                    v
                                  +------------------------------------+
                                  |         Pool Authority PDA         |
                                  |   PDA: ["omnifi-authority", pool]  |
                                  |   - Signs outbound CPI transfers   |
                                  |   - Owns Vault 0 & Vault 1 (ATAs)  |
                                  +------------------------------------+
```

---

## Key PDA Derivations

All PDAs use strict prefixes to guarantee namespace isolation:

| Account | PDA Seeds | Signer in CPI? | Purpose |
|---|---|---|---|
| `GlobalConfig` | `["omnifi-config"]` | No | Administrative parameters & pause |
| `PoolState` | `["omnifi-pool", mint0, mint1, fee_tier_le]` | No | Pool reserves, fee rate, LP supply |
| `Pool Authority` | `["omnifi-authority", pool_state_pubkey]` | **Yes** | Owns token vaults, signs CPI transfers |
| `LP Token Mint` | `["omnifi-lp-mint", pool_state_pubkey]` | No | Fungible SPL Token mint for liquidity |

---

## Local Deployment & Verification

### 1. Build the BPF Binaries
```bash
cd chains/solana
anchor build
```

### 2. Run Rust Unit Tests
```bash
cargo test
```

### 3. Run Clippy Lint Verification
```bash
cargo clippy -- -D warnings
```

### 4. Localnet Simulation & Migration
To deploy to a local validator:
```bash
solana-test-validator --reset &
anchor deploy
anchor migrate
```

---

## Operational Procedures & Invariant Guarantees

1. **$k$-Monotonicity:** On every swap, $(R_0 + \Delta_0)(R_1 - \Delta_1) \ge R_0 R_1$. Any instruction resulting in invariant contraction reverts with `ErrorCode::InvariantViolated`.
2. **Ceiling Fee on Input:** Swap fees are rounded up with $\lceil \frac{\text{amountIn} \cdot \text{fee}}{\text{FEE\_DENOMINATOR}} \rceil$ to prevent dust exploitation.
3. **Truncating Output:** Output amounts are rounded down to guarantee pool solvency.
4. **Permanent Liquidity Lock:** The first depositor has $1000$ base units (`MINIMUM_LIQUIDITY`) permanently locked to prevent share inflation attacks.
5. **No Key-Custody Risk:** User funds never enter unverified custody. Vaults are held exclusively by the programmatic `Pool Authority PDA`.

