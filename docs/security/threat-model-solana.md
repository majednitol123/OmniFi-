# OmniFi — Solana Threat Model

**Version:** 2.0  
**Status:** Implemented & Verified — mapped to remediated Anchor programs and Cargo test suites  
**Date:** 2026-11-03  
**Reference:** OmniFi Solana Program Architecture & Security Baseline  
**Spec References:** `solana-amm-spec.md`, `solana-clmm-spec.md`, `fee-and-rounding-spec.md`, `token-compatibility.md`

---

## 1. Assets to Protect

| Asset | Description | Criticality |
|-------|-------------|-------------|
| User token accounts | SPL Token / Token-2022 accounts owned by user wallets | Critical |
| Pool vault accounts | Token accounts owned by `pool_authority` PDA holding liquidity | Critical |
| LP position accounts | CLMM position state accounts tracking liquidity, tick range, fee growth | Critical |
| Protocol fee reserves | Accumulated protocol revenue (`protocol_fees_0`, `protocol_fees_1`) | High |
| Global config state | Emergency pause switch, default protocol fee fraction, fee recipient | Critical |
| Program upgrade authority | Squads multisig authority to upgrade deployed program bytecode | Critical |
| Tick array state | Discrete CLMM tick array accounts holding initialized tick states | High |
| Program Derived Addresses (PDAs) | Vault authorities and state derivations (`pool_state`, `pool_authority`) | Critical |
| Transaction event logs | Anchor self-describing event logs for off-chain indexing | Medium |

---

## 2. Threat Actors & Threat Profiles

| Actor | Access Level | Capability | Motivation |
|-------|-------------|-----------|------------|
| Malicious trader | Unprivileged user | Crafts transactions with manipulated parameters, fake accounts, slippage abuse | Financial gain via arbitrage / drain |
| Malicious token issuer | External developer | Deploys toxic SPL / Token-2022 tokens (transfer hooks, confiscation, variable fees) | Rug pull, fee theft |
| Malicious liquidity provider | Unprivileged user | Manipulates pool initialization, sets extreme prices, deposits dust | Exploit rounding, sandwich trades |
| MEV bot / searcher | Mempool observer | Front-runs, back-runs, sandwiches swaps across slots | Extract slippage & sandwich profit |
| Malicious / fake signer | Unprivileged user | Attempts calling privileged instructions without authority | State takeover / fee theft |
| Compromised RPC provider | Node operator | Injects stale slot data, drops transactions, reports false blocks | Front-running, griefing |
| Compromised multisig signer | 1-of-N admin | Attempts unauthorized upgrades or fee parameter tampering | Governance hijack |

---

## 3. Solana-Specific Attack Vector Analysis & Verification

| # | Attack Vector | Severity | Likelihood | Affected Component | Mitigation Strategy | Implemented Code Reference | Status |
|---|--------------|----------|------------|-------------------|---------------------|----------------------------|--------|
| SOL1 | Account substitution / fake PDA injection | Critical | High | All Instructions | Universal Anchor PDA validation: `seeds = [...]`, `bump = [...]`, `has_one = token_vault_0`, `has_one = token_vault_1`. | `omnifi_amm/src/instructions/swap.rs:8-55`, `omnifi_clmm/src/instructions/swap.rs:12-45` | Implemented & Verified |
| SOL2 | CPI privilege escalation / unauthorized signing | Critical | Medium | Vault Token Transfers | Pool authority PDA derives signer seeds exclusively (`POOL_AUTHORITY_SEED, pool_key, &[bump]`); cannot be used for non-pool CPI. | `omnifi_amm/src/instructions/swap.rs:114-131` | Implemented & Verified |
| SOL3 | Account aliasing (e.g. `vault_0 == vault_1`) | High | Medium | Create Pool, Swap | Strict mint order assertion (`mint_0 < mint_1`) at pool creation; distinct vault derivation. | `omnifi_amm/src/instructions/create_pool.rs` | Implemented & Verified |
| SOL4 | Program upgrade authority compromise | Critical | Low | Program Deployment | Upgrades managed via Squads 2-of-4 multisig. Upgrade authority keys isolated from dev keys. | ADR-011, `scripts/verify-roles-and-signers.sh` | Implemented & Verified |
| SOL5 | Arithmetic overflow/underflow | Critical | Low | AMM / CLMM Math | Rust `checked_add`, `checked_sub`, `checked_mul`, `checked_div` throughout; Q32.64/Q64.64 math in `full_math.rs`. | `omnifi_clmm/src/math/full_math.rs`, `omnifi_amm/src/math/` | Implemented & Verified |
| SOL6 | Rounding and dust extraction | High | Medium | Swap & Fee Math | Rounding favor always towards the pool: fee rounded UP (`mul_div_up`), amount out rounded DOWN (`mul_div_down`). | `fee-and-rounding-spec.md`, `omnifi_clmm/src/math/swap_math.rs` | Implemented & Verified |
| SOL7 | Protocol fee reserve desynchronization | High | Medium | AMM Swap (`swap.rs`) | Net input reserve addition strictly subtracts protocol fees (`reserve_in + (amount_in - protocol_fee)`); keeps vault balanced. | `omnifi_amm/src/instructions/swap.rs:134-150` | Implemented & Verified (F-05) |
| SOL8 | Pool initialization price manipulation | High | Medium | Create Pool / Init | `MINIMUM_LIQUIDITY = 1000` permanently burned on AMM init; CLMM enforces `MIN_SQRT_PRICE <= initial_price <= MAX_SQRT_PRICE`. | `omnifi_amm/src/instructions/create_pool.rs`, `omnifi_clmm/src/instructions/initialize_pool.rs` | Implemented & Verified |
| SOL9 | Token-2022 transfer-hook reentrancy / grief | High | Medium | Swap, Liquidity | Transfer-hook tokens explicitly blocked in Release 1.0; only standard SPL and non-hook tokens supported. | `docs/security/token-compatibility.md` §3 | Implemented & Verified |
| SOL10 | Token-2022 transfer-fee under-collection | High | Medium | Quote API / Programs | Actual received amount calculated after fee subtraction; transfer fee checked at boundary. | `solana-amm-spec.md` §6.3, `token-compatibility.md` | Implemented & Verified |
| SOL11 | Vault authority spoofing / drain | Critical | Low | Vault Accounts | Vault owner is verified as `pool_authority` PDA on every transfer CPI; only `pool_state` can generate valid signer seeds. | `omnifi_amm/src/instructions/swap.rs:28-33` | Implemented & Verified |
| SOL12 | Compute unit (CU) exhaustion DoS | Medium | High | CLMM Swap Traversal | Bounded tick array traversal: maximum 3 tick arrays inspected per swap instruction; compute budget ~120k CU. | `omnifi_clmm/src/instructions/swap.rs:44, 80-114` | Implemented & Verified |
| SOL13 | CLMM non-contiguous tick array injection | High | Medium | CLMM Swap | Traversal asserts exact contiguous spacing (`start_tick_index == prev ± ticks_per_array`) in swap direction. | `omnifi_clmm/src/instructions/swap.rs:98-114` | Implemented & Verified |
| SOL14 | CLMM exact-output partial fill exploit | High | Medium | CLMM Exact Output | Exact-output swaps strictly require `amount_remaining == 0`; partial execution reverts with `SlippageExceeded`. | `omnifi_clmm/src/instructions/swap.rs:306-319` | Implemented & Verified (F-06) |
| SOL15 | Missing signer validation on privileged ops | Critical | Low | Admin & Config Ops | Signer constraint `pub authority: Signer<'info>` enforced on `initialize_config`, `update_config`, `collect_fees`. | `omnifi_amm/src/instructions/admin.rs`, `omnifi_clmm/src/instructions/admin.rs` | Implemented & Verified |
| SOL16 | Reorg / finality inconsistency in indexers | Medium | Medium | Solana Indexer | Indexer processes finalized blocks or confirms slot depth >= 32 before committing state to PostgreSQL. | `services/indexer-solana/src/` | Implemented & Verified |
| SOL17 | Stale transaction simulation / replay | Medium | Medium | RPC & Prepare API | Recent blockhash lifetime checked; transaction simulation verifies account keys and balances before signing. | `packages/rpc-resilience/`, `services/quote-api/src/routes/simulate.ts` | Implemented & Verified |
| SOL18 | Account closing / rent theft | Medium | Low | Close Position / Pool | `close_position` asserts `position.liquidity == 0` AND `tokens_owed_0 == 0` AND `tokens_owed_1 == 0` before closing. | `omnifi_clmm/src/instructions/close_position.rs` | Implemented & Verified |
| SOL19 | Unchecked Borsh log decoding / format spoofing | Medium | Low | Solana Log Decoder | Indexer decodes logs using strict 8-byte Anchor discriminator + Borsh schema deserialization; no regex splitting. | `services/indexer-solana/src/log-decoder.ts` | Implemented & Verified (F-11) |

---

## 4. Trust Boundaries & Entry Points

```
[ External User / Wallet ]
            │
            ▼ (Signed Transaction over RPC)
┌────────────────────────────────────────────────────────┐
│ Solana Runtime Core                                    │
│  ├─ SigVerify (Ed25519)                                │
│  ├─ Account Lock Manager (Read/Write Locks)            │
│  └─ Compute Budget Enforcer                            │
└───────────────────────────┬────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────┐
│ Anchor Program: omnifi_amm / omnifi_clmm               │
│  ├─ [Entry 1] initialize_pool / create_pool            │
│  ├─ [Entry 2] add_liquidity / increase_liquidity       │
│  ├─ [Entry 3] remove_liquidity / decrease_liquidity    │
│  ├─ [Entry 4] swap_exact_input / swap_exact_output     │
│  ├─ [Entry 5] open_position / close_position           │
│  ├─ [Entry 6] collect_fees                             │
│  └─ [Entry 7] update_config (Admin Signer Only)        │
└──────────────┬──────────────────────────┬──────────────┘
               │                          │
               ▼                          ▼
┌──────────────────────────────┐ ┌──────────────────────────────┐
│ SPL Token Program (CPI)      │ │ Pool State & Vault PDAs      │
│  ├─ Transfer (In/Out)        │ │  ├─ pool_state               │
│  ├─ MintTo / Burn            │ │  ├─ pool_authority           │
│  └─ Token-2022 Compatibility │ │  └─ tick_array[0..3]         │
└──────────────────────────────┘ └──────────────────────────────┘
```

---

## 5. Security Invariant Matrix

1. **Vault Balance Conservation:**  
   $$\text{VaultBalance}_0 = \text{reserve}_0 + \text{protocol\_fees}_0$$  
   $$\text{VaultBalance}_1 = \text{reserve}_1 + \text{protocol\_fees}_1$$  
   Pool authority PDA owns all vault accounts; user cannot withdraw beyond proportional LP shares or valid swap deltas.

2. **Constant Product Invariant ($k$-check):**  
   $$k_{\text{after}} = \text{reserve}_0^{\text{after}} \times \text{reserve}_1^{\text{after}} \ge k_{\text{before}} = \text{reserve}_0^{\text{before}} \times \text{reserve}_1^{\text{before}}$$  
   Enforced explicitly in `omnifi_amm/src/instructions/swap.rs:157`.

3. **CLMM Liquidity Monotonicity:**  
   $$\Delta L_{\text{global}} = \sum \Delta L_{\text{positions}}$$  
   When crossing initialized ticks, $L_{\text{active}}$ updates strictly by $\pm \text{liquidity\_net}$.

4. **Slippage Enforcement:**  
   - Exact Input: $\text{amount\_out} \ge \text{minimum\_amount\_out}$
   - Exact Output: $\text{amount\_in} \le \text{maximum\_amount\_in} \land \text{amount\_remaining} == 0$

5. **Tick Array Contiguity:**  
   $$\text{start\_tick\_index}_{i} = \text{start\_tick\_index}_{i-1} \pm (\text{TICK\_ARRAY\_SIZE} \times \text{tick\_spacing})$$

---

## 6. Residual Risks & Review Sign-off

| Risk | Likelihood | Impact | Acceptance Rationale |
|------|------------|--------|----------------------|
| Solana Runtime Concurrency Jitter | Low | Medium | Solana validator leader schedule and account write-locks can cause transient transaction drops during extreme congestion. Mitigated by `rpc-resilience` backoff and retry policies. |
| Account Rent Exemption Policy Shifts | Very Low | Low | All accounts initialized with 8-byte discriminator + exact size, funded to standard 2-year rent-exemption baseline. |
| External Token Program Malfunction | Low | High | Tokens with unannounced upgrades or arbitrary freeze authority can halt swaps. Mitigated by token registry allowlists and `LOW` risk tier restrictions. |

- **Review Status:** 100% Implemented & Verified in Rust Unit and Anchor Integration Test Suites.
- **Verification Suites:** `chains/solana/programs/omnifi_amm/src/lib.rs` (6 unit tests), `chains/solana/programs/omnifi_clmm/src/lib.rs` (16 unit tests), `chains/solana/tests/` (7 integration tests).
