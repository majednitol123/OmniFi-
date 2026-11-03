# OmniFi — Solana AMM Program Specification

**Version:** 1.0  
**Status:** Phase 1 deliverable  
**Date:** 2026-11-01  
**Scope:** Solana-Native Constant-Product AMM Program  
**Related ADRs:** [ADR-001 (Chain Selection)](../adr/ADR-001-chain-selection.md), [ADR-006 (Token Policy)](../adr/ADR-006-token-policy.md), [ADR-007 (Fee & Economic Parameters)](../adr/ADR-007-economic-parameters.md), [ADR-010 (Upgradeability)](../adr/ADR-010-upgradeability.md), [ADR-011 (Admin & Custody)](../adr/ADR-011-admin-custody.md), [ADR-015 (Token Authorization)](../adr/ADR-015-token-authorization.md)  
**Normative References:** [Fee and Rounding Specification](fee-and-rounding-spec.md), [Token Compatibility Specification](../security/token-compatibility.md), [Solana Threat Model](../security/threat-model-solana.md)  

---

## Scope and Intent

This document specifies the technical architecture, account model, PDA derivation rules, instruction interfaces, validation logic, token program compatibility, arithmetic formulas, and lifecycle policies for OmniFi's constant-product Automated Market Maker (AMM) program on Solana.

> [!IMPORTANT]
> **Solana-Native Architecture Design Principle**  
> Solana's runtime architecture differs fundamentally from EVM-based state models. Solana transactions must explicitly declare all accounts read or written upfront, code execution is completely decoupled from state storage, and reentrancy/flash-accounting assumptions from the EVM do not translate. This specification is designed natively around Solana's account model, Program Derived Addresses (PDAs), Cross-Program Invocations (CPIs), and explicit account validation. It is **not** an EVM port.

---

## Table of Contents

1. [Architectural Overview & Solana Runtime Model](#1-architectural-overview--solana-runtime-model)
2. [§1: Account Model & Memory Layout](#2-1-account-model--memory-layout)
3. [§2: PDA Seed Strategy & Derivation](#3-2-pda-seed-strategy--derivation)
4. [§3: Account Schemas & Ownership Matrix](#4-3-account-schemas--ownership-matrix)
5. [§4: Instruction Interfaces & Execution Pseudocode](#5-4-instruction-interfaces--execution-pseudocode)
6. [§5: Validation Requirements & Security Controls](#6-5-validation-requirements--security-controls)
7. [§6: Token Program Compatibility (SPL & Token-2022)](#7-6-token-program-compatibility-spl--token-2022)
8. [§7: Compute-Unit (CU) Budget & Performance](#8-7-compute-unit-cu-budget--performance)
9. [§8: Account Lifecycle & Rent Exemption](#9-8-account-lifecycle--rent-exemption)
10. [§9: Program Error Codes & Event Logging](#10-9-program-error-codes--event-logging)
11. [§10: Client Derivation & SDK Guide](#11-10-client-derivation--sdk-guide)

---

## 1. Architectural Overview & Solana Runtime Model

### 1.1 Decoupled Code and State

On Solana, program code is stateless and immutable (or upgradeable only through explicit multisig-governed loader instructions per [ADR-010](../adr/ADR-010-upgradeability.md) and [ADR-011](../adr/ADR-011-admin-custody.md)). All protocol state resides in data accounts owned by the OmniFi AMM Program ID (`ProgramID`).

```
+-------------------------------------------------------------------------------------------------+
|                                     Solana Runtime Boundary                                     |
+-------------------------------------------------------------------------------------------------+
                                                 |
                                                 v
+-------------------------------------------------------------------------------------------------+
|                                 OmniFi AMM Program (Stateless)                                  |
|   - Instruction dispatch & validation                                                           |
|   - Integer constant-product math (checked u64 / u128)                                          |
|   - CPI coordination via Program Derived Address (PDA) signing                                  |
+-------------------------------------------------------------------------------------------------+
          |                                      |                                    |
          v                                      v                                    v
+-----------------------+              +-------------------+               +----------------------+
|  GlobalConfig Account |              | PoolState Account |               |  Pool Authority PDA  |
|  - Authority (multisig|              | - Mint 0 & Mint 1 |               |  (Off-curve Signer)  |
|  - Fee authority      |              | - Fee tier        |               |  Signs for Vaults &  |
|  - Protocol fee split |              | - Reserve 0 & 1   |               |  LP Token Minting    |
|  - Emergency pause    |              | - LP token mint   |               +----------------------+
+-----------------------+              | - Protocol fees   |                          |
                                       +-------------------+                          v
                                                 |                         +----------------------+
                                                 +------------------------>| SPL Token / 2022     |
                                                                           | - Vault 0 Account    |
                                                                           | - Vault 1 Account    |
                                                                           | - LP Token Mint      |
                                                                           +----------------------+
```

### 1.2 Program Invariants

1. **Deterministic State Derivation:** Every protocol account is either a deterministic PDA derived from predefined seeds or an Associated Token Account (ATA) owned by a protocol PDA.
2. **Authority Decoupling:** The program never delegates fund custody to user-controlled keys. Vaults are owned strictly by the `Pool Authority PDA`.
3. **No Dynamic Account Discovery on Chain:** The runtime requires transactions to supply all accessed account public keys. All accounts must be verified on chain before use.
4. **Conservation of Assets:** In any swap or liquidity operation, tokens entering or leaving vaults must balance with pool reserve updates according to the constant-product invariant $x \cdot y \ge k$.

---

## 2. §1: Account Model & Memory Layout

The OmniFi Solana AMM defines five distinct account roles:

| Account | Type | PDA Seeds | Owner Program | Purpose |
|---------|------|-----------|---------------|---------|
| `GlobalConfig` | Protocol State | `["omnifi-config"]` | `OmniFi Program` | Protocol-wide administrative parameters and emergency switch |
| `PoolState` | Pool State | `["omnifi-pool", mint0, mint1, fee_tier_le]` | `OmniFi Program` | Reserves, fees, mint references, and pool status |
| `Pool Authority` | Signer PDA | `["omnifi-authority", pool_state]` | System Program (Off-curve) | Autonomous signer for CPI vault transfers & LP minting |
| `Token Vault 0` | SPL Account | ATA owned by `Pool Authority` | SPL Token / Token-2022 | Custody of pool `token_mint_0` reserves |
| `Token Vault 1` | SPL Account | ATA owned by `Pool Authority` | SPL Token / Token-2022 | Custody of pool `token_mint_1` reserves |
| `LP Token Mint` | SPL Mint | Keypair or PDA | SPL Token Program | Fungible liquidity share token mint |

---

### 2.1 GlobalConfig Account

The `GlobalConfig` account is a program-wide singleton that stores administrative authorities, global fee parameters, and the emergency pause switch.

#### Field Specification

| Field Name | Type | Size (Bytes) | Offset | Description |
|------------|------|--------------|--------|-------------|
| `discriminator` | `u8` | 1 | 0 | Fixed discriminator: `0x01` (`GlobalConfig`) |
| `version` | `u8` | 1 | 1 | State schema version: `1` |
| `authority` | `Pubkey` | 32 | 2 | Protocol admin multisig (Squads 3-of-5 per [ADR-011](../adr/ADR-011-admin-custody.md)) |
| `fee_authority` | `Pubkey` | 32 | 34 | Fee recipient & manager multisig (Squads 2-of-3) |
| `protocol_fee_fraction` | `u8` | 1 | 66 | Protocol fee share: `0` (off) or `1` (25% of LP fee) |
| `emergency_paused` | `bool` | 1 | 67 | Global emergency freeze flag (`0` = active, `1` = paused) |
| `padding` | `[u8; 64]` | 64 | 68 | Reserved for future expansion (zeroed) |

**Total Size:** $1 + 1 + 32 + 32 + 1 + 1 + 64 = 132$ bytes.

```
GlobalConfig Byte Layout (132 bytes):
+---------------+-------------+-------------------+-----------------------+-------------------------+--------------------+---------------------+
| discr (0x01)  | version (1) | authority (32B)   | fee_authority (32B)   | proto_fee_frac (1B)     | paused (1B)        | padding (64B)       |
| Offset: 0     | Offset: 1   | Offset: 2         | Offset: 34            | Offset: 66              | Offset: 67         | Offset: 68..131     |
+---------------+-------------+-------------------+-----------------------+-------------------------+--------------------+---------------------+
```

---

### 2.2 PoolState Account

Each liquidity pool has exactly one `PoolState` account holding the accounting state for the pair.

#### Field Specification

| Field Name | Type | Size (Bytes) | Offset | Description |
|------------|------|--------------|--------|-------------|
| `discriminator` | `u8` | 1 | 0 | Fixed discriminator: `0x02` (`PoolState`) |
| `version` | `u8` | 1 | 1 | State schema version: `1` |
| `token_mint_0` | `Pubkey` | 32 | 2 | Canonical token 0 mint address (`mint_0 < mint_1`) |
| `token_mint_1` | `Pubkey` | 32 | 34 | Canonical token 1 mint address |
| `fee_tier` | `u32` | 4 | 66 | LP fee tier in hundredths of bps (little-endian) |
| `reserve_0` | `u64` | 8 | 70 | Current active token 0 reserve balance |
| `reserve_1` | `u64` | 8 | 78 | Current active token 1 reserve balance |
| `lp_mint` | `Pubkey` | 32 | 86 | LP token mint account address |
| `lp_supply` | `u64` | 8 | 118 | Total circulating LP token supply |
| `protocol_fees_0` | `u64` | 8 | 126 | Accumulated uncollected protocol fees for token 0 |
| `protocol_fees_1` | `u64` | 8 | 134 | Accumulated uncollected protocol fees for token 1 |
| `bump` | `u8` | 1 | 142 | Canonical PDA bump seed for `PoolState` |
| `is_paused` | `bool` | 1 | 143 | Pool-level operational pause flag |
| `padding` | `[u8; 64]` | 64 | 144 | Reserved for future expansion (zeroed) |

**Total Size:** $1 + 1 + 32 + 32 + 4 + 8 + 8 + 32 + 8 + 8 + 8 + 1 + 1 + 64 = 208$ bytes.

```
PoolState Byte Layout (208 bytes):
+--------------+-------------+-------------------+-------------------+---------------+----------------+----------------+
| discr (0x02) | version (1) | token_mint_0 (32B)| token_mint_1 (32B)| fee_tier (4B) | reserve_0 (8B) | reserve_1 (8B) |
| Offset: 0    | Offset: 1   | Offset: 2         | Offset: 34        | Offset: 66    | Offset: 70     | Offset: 78     |
+--------------+-------------+-------------------+-------------------+---------------+----------------+----------------+
+-------------------+---------------+--------------------+--------------------+----------+-------------+---------------+
| lp_mint (32B)     | lp_supply (8B)| proto_fees_0 (8B)  | proto_fees_1 (8B)  | bump (1B)| paused (1B) | padding (64B) |
| Offset: 86        | Offset: 118   | Offset: 126        | Offset: 134        | Off: 142 | Off: 143    | Off: 144..207 |
+-------------------+---------------+--------------------+--------------------+----------+-------------+---------------+
```

---

### 2.3 Pool Authority PDA

The `Pool Authority PDA` is an off-curve address that possesses no private key and stores no account data. It acts as the programmatic authority for:
1. Ownership of `Token Vault 0` and `Token Vault 1`.
2. Mint authority for the `LP Token Mint`.
3. Signing outbound CPI calls (e.g., token transfers to users during swaps or liquidity removals, and LP token minting during liquidity additions).

- **PDA Seeds:** `[b"omnifi-authority", pool_state_pubkey.as_ref()]`
- **Signer Seed Construction in CPI:**
  `&[b"omnifi-authority", pool_state_pubkey.as_ref(), &[authority_bump]]`

---

### 2.4 Token Vaults

Vaults hold the underlying tokens locked in the pool.
- Each pool has two vaults: `vault_0` (for `token_mint_0`) and `vault_1` (for `token_mint_1`).
- Vaults are standard token accounts owned by the `Pool Authority PDA`.
- Recommended derivation: Canonical Associated Token Accounts (ATAs) of `Pool Authority PDA` derived via the Associated Token Account Program.
- **Owner Field in Token Account:** Must equal `Pool Authority PDA`.
- **Mint Field in Token Account:** Must equal `token_mint_0` or `token_mint_1` respectively.

---

### 2.5 LP Token Mint

- Standard SPL Token mint tracking user liquidity shares.
- **Mint Authority:** `Pool Authority PDA`.
- **Freeze Authority:** `None` (or `Pool Authority PDA` to ensure non-freezable trustless positions).
- **Decimals:** 9 (standard precision for Solana AMM LP tokens).
- **Initial Lock:** The first depositor has $1000$ base units (`MINIMUM_LIQUIDITY`) minted to an unredeemable dead address to permanently neutralize pool inflation attacks.

---

## 3. §2: PDA Seed Strategy & Derivation

All Program Derived Addresses in the OmniFi protocol use strict namespacing, canonical ordering, and deterministic bump verification.

### 3.1 Namespace Isolation

All PDA derivations begin with an ASCII prefix starting with `"omnifi-"`. This prevents seed collision with external programs or other protocols operating on the same Solana cluster.

```
GlobalConfig Seed:      [ b"omnifi-config" ]
PoolState Seed:         [ b"omnifi-pool", mint_0_bytes, mint_1_bytes, fee_tier_le_bytes ]
Pool Authority Seed:    [ b"omnifi-authority", pool_state_pubkey_bytes ]
```

### 3.2 Canonical Token Ordering

To prevent duplicate pools for the same pair of tokens, token mint addresses are ordered lexicographically by their raw 32-byte representation:

```
function sortMints(mintA: Pubkey, mintB: Pubkey) -> (Pubkey, Pubkey):
    require(mintA != mintB, ErrorCode.IdenticalTokenMints)
    if mintA.toBytes() < mintB.toBytes():
        return (mintA, mintB)
    else:
        return (mintB, mintA)
```

- If `mint_0 == mint_1`, transaction execution is immediately rejected.
- If an instruction supplies mints in non-canonical order (`mint_0 > mint_1`), execution fails with `ErrorCode.TokensNotSorted`.

### 3.3 Bump Storage and Optimization

1. **Storage at Creation:** During `create_pool`, the canonical bump (the highest valid 8-bit bump that places the address off the Ed25519 elliptic curve) is derived and saved into `PoolState.bump`.
2. **Re-derivation Elimination:** Subsequent instructions (`swap`, `add_liquidity`, `remove_liquidity`) do not execute the compute-heavy `find_program_address` loop. Instead, they use `create_program_address` with the stored bump:
   $$\text{PDA} = \text{create\_program\_address}(\text{seeds} \cup \{\text{bump}\}, \text{ProgramID})$$
3. **Safety Check:** The resulting derived address is checked against the supplied account key. If they do not match, the instruction fails with `ErrorCode.InvalidPdaBump`.

---

## 4. §3: Account Schemas & Ownership Matrix

### 4.1 Serialization Format

OmniFi accounts use strict **Borsh (Binary Object Representation Serializer for Hashing)** serialization with explicit byte-level layout:
- Little-endian encoding for all multi-byte integers (`u16`, `u32`, `u64`, `u128`).
- Booleans represented as single bytes (`0x00` = false, `0x01` = true; any value $\ge 0x02$ triggers deserialization error).
- Zero-copy deserialization patterns are encouraged for performance-critical swap instructions.

### 4.2 Account Ownership Rules

Before executing any logic, the program asserts ownership of all submitted accounts:
- `GlobalConfig`: Owned by `OmniFi Program ID`.
- `PoolState`: Owned by `OmniFi Program ID`.
- `Pool Authority PDA`: Must be an off-curve address owned by the System Program (`11111111111111111111111111111111`) with zero lamports or rent-exempt balance.
- `Token Vaults`: Owned by the respective Token Program (`Tokenkeg...` or `TokenzQd...`).
- `LP Mint`: Owned by the respective Token Program.

### 4.3 Account Permissions Matrix

The following matrix defines the mutability and signer requirements for each instruction:

| Instruction | GlobalConfig | PoolState | Pool Auth PDA | Vault 0 | Vault 1 | LP Mint | User Token 0 | User Token 1 | User LP | User Signer | Admin Signer |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| `initialize_config` | **W** | — | — | — | — | — | — | — | — | — | **S** |
| `create_pool` | R | **W** | R | **W** | **W** | **W** | — | — | — | **S** | — |
| `add_liquidity` | R | **W** | R | **W** | **W** | **W** | **W** | **W** | **W** | **S** | — |
| `remove_liquidity`| R | **W** | R | **W** | **W** | **W** | **W** | **W** | **W** | **S** | — |
| `swap` | R | **W** | R | **W** | **W** | — | **W** | **W** | — | **S** | — |
| `collect_fees` | R | **W** | R | **W** | **W** | — | **W** | **W** | — | — | **S** |
| `update_config` | **W** | — | — | — | — | — | — | — | — | — | **S** |

*Legend: **W** = Writable; R = Read-Only; **S** = Must be Signer; — = Not Present in Instruction.*

---

## 5. §4: Instruction Interfaces & Execution Pseudocode

Every instruction starts with an 8-bit instruction discriminator in the instruction data payload:

| Opcode | Instruction Name | Purpose |
|--------|------------------|---------|
| `0x00` | `initialize_config` | Initialize singleton `GlobalConfig` |
| `0x01` | `create_pool` | Instantiate new pool state, vaults, and LP mint |
| `0x02` | `add_liquidity` | Deposit token pair and mint LP tokens |
| `0x03` | `remove_liquidity` | Burn LP tokens and withdraw token pair |
| `0x04` | `swap` | Constant-product swap of exact input tokens |
| `0x05` | `collect_protocol_fees` | Withdraw accrued protocol fees to treasury |
| `0x06` | `update_config` | Admin modification of fee fraction or authorities |
| `0x07` | `set_pool_pause` | Emergency pause/unpause for individual pool |

---

### 5.1 Instruction: `initialize_config` (Opcode 0x00)

Initializes the program's singleton configuration. Callable exactly once during protocol deployment.

#### Accounts Required

```
0. [WRITE, SIGNER] payer: Fee payer funding rent for GlobalConfig
1. [WRITE]         global_config: PDA ["omnifi-config"]
2. []              authority: Multisig admin key (Pubkey)
3. []              fee_authority: Fee recipient multisig key (Pubkey)
4. []              system_program: System Program (11111111111111111111111111111111)
```

#### Instruction Data

```
struct InitializeConfigData {
    discriminator: u8,            // 0x00
    protocol_fee_fraction: u8,    // 0 or 1 (per ADR-007, 0 = off, 1 = 25%)
}
```

#### Execution Pseudocode

```
function process_initialize_config(accounts, data):
    assert(accounts.payer.is_signer, ErrorCode.MissingRequiredSigner)
    assert(accounts.system_program.key == SYSTEM_PROGRAM_ID, ErrorCode.InvalidProgramId)
    
    // 1. Derive and validate GlobalConfig PDA
    (expected_pda, bump) = derive_pda([b"omnifi-config"], PROGRAM_ID)
    assert(accounts.global_config.key == expected_pda, ErrorCode.InvalidPdaAddress)
    assert(accounts.global_config.data_len == 0, ErrorCode.AccountAlreadyInitialized)
    
    // 2. Validate configuration arguments
    assert(data.protocol_fee_fraction <= 1, ErrorCode.InvalidFeeParameter)
    
    // 3. Allocate and fund GlobalConfig account (132 bytes)
    rent_exempt_lamports = Rent.get().minimum_balance(132)
    cpi_create_account(
        from: accounts.payer,
        to: accounts.global_config,
        lamports: rent_exempt_lamports,
        space: 132,
        owner: PROGRAM_ID,
        signer_seeds: [b"omnifi-config", [bump]]
    )
    
    // 4. Initialize fields
    config = GlobalConfig {
        discriminator: 0x01,
        version: 1,
        authority: accounts.authority.key,
        fee_authority: accounts.fee_authority.key,
        protocol_fee_fraction: data.protocol_fee_fraction,
        emergency_paused: false,
        padding: [0; 64]
    }
    serialize(config, accounts.global_config.data)
```

---

### 5.2 Instruction: `create_pool` (Opcode 0x01)

Creates a new liquidity pool for a canonical token pair and supported fee tier. Initializes the `PoolState`, `Pool Authority PDA`, token vaults, and `LP Mint`.

#### Accounts Required

```
0.  [WRITE, SIGNER] payer: Transaction fee & rent payer
1.  []              global_config: PDA ["omnifi-config"]
2.  [WRITE]         pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
3.  []              pool_authority: PDA ["omnifi-authority", pool_state]
4.  []              token_mint_0: Canonical token 0 mint (mint0 < mint1)
5.  []              token_mint_1: Canonical token 1 mint
6.  [WRITE]         token_vault_0: ATA owned by pool_authority for mint 0
7.  [WRITE]         token_vault_1: ATA owned by pool_authority for mint 1
8.  [WRITE]         lp_mint: Uninitialized SPL Token Mint (keypair or PDA)
9.  []              token_program_0: Token Program ID for mint 0
10. []              token_program_1: Token Program ID for mint 1
11. []              lp_token_program: Classic SPL Token Program ID
12. []              system_program: System Program
13. []              associated_token_program: Associated Token Program
14. []              sysvar_rent: Rent Sysvar
```

#### Instruction Data

```
struct CreatePoolData {
    discriminator: u8,     // 0x01
    fee_tier: u32,         // 100, 500, 3000, or 10000 (per ADR-007)
}
```

#### Execution Pseudocode

```
function process_create_pool(accounts, data):
    assert(accounts.payer.is_signer, ErrorCode.MissingRequiredSigner)
    
    // 1. Verify GlobalConfig state
    config = deserialize_config(accounts.global_config)
    assert(config.discriminator == 0x01, ErrorCode.InvalidAccountDiscriminator)
    assert(!config.emergency_paused, ErrorCode.ProtocolEmergencyPaused)
    
    // 2. Validate fee tier per ADR-007
    assert(
        data.fee_tier == 100 || data.fee_tier == 500 || 
        data.fee_tier == 3000 || data.fee_tier == 10000,
        ErrorCode.InvalidFeeTier
    )
    
    // 3. Validate canonical token ordering (raw byte comparison)
    assert(accounts.token_mint_0.key.toBytes() < accounts.token_mint_1.key.toBytes(), ErrorCode.TokensNotSorted)
    
    // 4. Derive and assert PoolState PDA
    (expected_pool_pda, pool_bump) = derive_pda([
        b"omnifi-pool",
        accounts.token_mint_0.key.as_ref(),
        accounts.token_mint_1.key.as_ref(),
        data.fee_tier.to_le_bytes()
    ], PROGRAM_ID)
    assert(accounts.pool_state.key == expected_pool_pda, ErrorCode.InvalidPdaAddress)
    assert(accounts.pool_state.data_len == 0, ErrorCode.PoolAlreadyExists)
    
    // 5. Derive and assert Pool Authority PDA
    (expected_auth_pda, auth_bump) = derive_pda([
        b"omnifi-authority",
        accounts.pool_state.key.as_ref()
    ], PROGRAM_ID)
    assert(accounts.pool_authority.key == expected_auth_pda, ErrorCode.InvalidAuthorityAddress)
    
    // 6. Validate Token Program IDs and extensions
    validate_token_mint_and_program(accounts.token_mint_0, accounts.token_program_0)
    validate_token_mint_and_program(accounts.token_mint_1, accounts.token_program_1)
    assert(accounts.lp_token_program.key == SPL_TOKEN_PROGRAM_ID, ErrorCode.InvalidLpTokenProgram)
    
    // 7. Create PoolState account (208 bytes)
    rent_exempt_lamports = Rent.get().minimum_balance(208)
    cpi_create_account(
        from: accounts.payer,
        to: accounts.pool_state,
        lamports: rent_exempt_lamports,
        space: 208,
        owner: PROGRAM_ID,
        signer_seeds: [
            b"omnifi-pool",
            accounts.token_mint_0.key.as_ref(),
            accounts.token_mint_1.key.as_ref(),
            data.fee_tier.to_le_bytes(),
            [pool_bump]
        ]
    )
    
    // 8. Create LP Token Mint with authority = Pool Authority PDA
    cpi_create_mint(
        payer: accounts.payer,
        mint: accounts.lp_mint,
        decimals: 9,
        mint_authority: accounts.pool_authority.key,
        freeze_authority: null,
        token_program: accounts.lp_token_program
    )
    
    // 9. Initialize Token Vaults as ATAs owned by Pool Authority PDA
    cpi_create_ata_if_not_exists(
        payer: accounts.payer,
        ata: accounts.token_vault_0,
        owner: accounts.pool_authority.key,
        mint: accounts.token_mint_0.key,
        token_program: accounts.token_program_0
    )
    cpi_create_ata_if_not_exists(
        payer: accounts.payer,
        ata: accounts.token_vault_1,
        owner: accounts.pool_authority.key,
        mint: accounts.token_mint_1.key,
        token_program: accounts.token_program_1
    )
    
    // 10. Store initial state in PoolState
    pool = PoolState {
        discriminator: 0x02,
        version: 1,
        token_mint_0: accounts.token_mint_0.key,
        token_mint_1: accounts.token_mint_1.key,
        fee_tier: data.fee_tier,
        reserve_0: 0,
        reserve_1: 0,
        lp_mint: accounts.lp_mint.key,
        lp_supply: 0,
        protocol_fees_0: 0,
        protocol_fees_1: 0,
        bump: pool_bump,
        is_paused: false,
        padding: [0; 64]
    }
    serialize(pool, accounts.pool_state.data)
```

---

### 5.3 Instruction: `add_liquidity` (Opcode 0x02)

Deposits tokens into pool vaults and mints proportional LP shares to the depositor.

#### Mathematical Formulas & Rounding Rules

1. **First Deposit (`lp_supply == 0`):**
   $$\text{initial\_lp} = \lfloor\sqrt{\text{amount}_0 \cdot \text{amount}_1}\rfloor$$
   $$\text{assert}(\text{initial\_lp} > \text{MINIMUM\_LIQUIDITY})$$
   $$\text{lp\_minted} = \text{initial\_lp} - \text{MINIMUM\_LIQUIDITY}$$
   $$\text{MINIMUM\_LIQUIDITY} = 1000 \quad (\text{permanently locked})$$

2. **Subsequent Deposits (`lp_supply > 0`):**
   $$\text{lp}_0 = \left\lfloor \frac{\text{amount}_0 \cdot \text{lp\_supply}}{\text{reserve}_0} \right\rfloor$$
   $$\text{lp}_1 = \left\lfloor \frac{\text{amount}_1 \cdot \text{lp\_supply}}{\text{reserve}_1} \right\rfloor$$
   $$\text{lp\_minted} = \min(\text{lp}_0, \text{lp}_1)$$
   $$\text{assert}(\text{lp\_minted} \ge \text{minimum\_lp\_minted})$$

All LP share computations round **DOWN** (truncating integer division) to protect existing liquidity providers from pool share dilution per [Fee and Rounding Specification](fee-and-rounding-spec.md) §4.

#### Accounts Required

```
0.  [WRITE, SIGNER] user: Liquidity provider & signer
1.  []              global_config: PDA ["omnifi-config"]
2.  [WRITE]         pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
3.  []              pool_authority: PDA ["omnifi-authority", pool_state]
4.  [WRITE]         token_vault_0: Vault token 0 account
5.  [WRITE]         token_vault_1: Vault token 1 account
6.  [WRITE]         lp_mint: Pool LP token mint
7.  [WRITE]         user_token_0: Depositor token 0 account
8.  [WRITE]         user_token_1: Depositor token 1 account
9.  [WRITE]         user_lp: Depositor LP token account
10. []              token_program_0: Token Program ID for token 0
11. []              token_program_1: Token Program ID for token 1
12. []              lp_token_program: Classic SPL Token Program ID
```

#### Instruction Data

```
struct AddLiquidityData {
    discriminator: u8,          // 0x02
    amount_0_desired: u64,      // Token 0 quantity to deposit
    amount_1_desired: u64,      // Token 1 quantity to deposit
    minimum_lp_minted: u64,     // Slippage guard: minimum LP shares to accept
}
```

#### Execution Pseudocode

```
function process_add_liquidity(accounts, data):
    assert(accounts.user.is_signer, ErrorCode.MissingRequiredSigner)
    assert(data.amount_0_desired > 0 && data.amount_1_desired > 0, ErrorCode.ZeroDepositAmount)
    
    // 1. Verify GlobalConfig and Pool operational status
    config = deserialize_config(accounts.global_config)
    assert(!config.emergency_paused, ErrorCode.ProtocolEmergencyPaused)
    
    pool = deserialize_pool(accounts.pool_state)
    assert(!pool.is_paused, ErrorCode.PoolPaused)
    
    // 2. Validate PDA derivations
    verify_pool_pda(accounts.pool_state, pool.token_mint_0, pool.token_mint_1, pool.fee_tier, pool.bump)
    (expected_auth, auth_bump) = derive_pda([b"omnifi-authority", accounts.pool_state.key.as_ref()], PROGRAM_ID)
    assert(accounts.pool_authority.key == expected_auth, ErrorCode.InvalidAuthorityAddress)
    
    // 3. Validate vaults and LP mint matching pool state
    assert(accounts.lp_mint.key == pool.lp_mint, ErrorCode.InvalidLpMint)
    verify_vault(accounts.token_vault_0, pool.token_mint_0, expected_auth)
    verify_vault(accounts.token_vault_1, pool.token_mint_1, expected_auth)
    
    // 4. Calculate LP tokens to mint
    var lp_to_mint: u64 = 0
    var actual_amount_0: u64 = data.amount_0_desired
    var actual_amount_1: u64 = data.amount_1_desired
    
    if pool.lp_supply == 0:
        // First deposit: Geometric mean formula
        root_k = integer_sqrt(u128(actual_amount_0) * u128(actual_amount_1))
        assert(root_k > 1000, ErrorCode.InitialLiquidityTooLow)
        
        lp_to_mint = u64(root_k - 1000)
        
        // Lock 1000 units permanently into pool supply
        pool.lp_supply = 1000
    else:
        // Subsequent deposit: Proportional calculation
        lp_0 = u64((u128(actual_amount_0) * u128(pool.lp_supply)) / u128(pool.reserve_0))
        lp_1 = u64((u128(actual_amount_1) * u128(pool.lp_supply)) / u128(pool.reserve_1))
        
        lp_to_mint = min(lp_0, lp_1)
        assert(lp_to_mint > 0, ErrorCode.ZeroLpMinted)
    
    // 5. Slippage check
    assert(lp_to_mint >= data.minimum_lp_minted, ErrorCode.ExceededSlippageTolerance)
    
    // 6. Transfer token 0 from user to vault 0 (handle fee-on-transfer if Token-2022)
    deposited_0 = cpi_transfer_checked_in(
        from: accounts.user_token_0,
        to: accounts.token_vault_0,
        mint: pool.token_mint_0,
        amount: actual_amount_0,
        authority: accounts.user,
        program: accounts.token_program_0
    )
    
    // 7. Transfer token 1 from user to vault 1
    deposited_1 = cpi_transfer_checked_in(
        from: accounts.user_token_1,
        to: accounts.token_vault_1,
        mint: pool.token_mint_1,
        amount: actual_amount_1,
        authority: accounts.user,
        program: accounts.token_program_1
    )
    
    // 8. Mint LP shares to user signed by Pool Authority PDA
    cpi_mint_to(
        mint: accounts.lp_mint,
        to: accounts.user_lp,
        amount: lp_to_mint,
        authority: accounts.pool_authority,
        signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
        program: accounts.lp_token_program
    )
    
    // 9. Update state reserves and total LP supply
    pool.reserve_0 = checked_add(pool.reserve_0, deposited_0)
    pool.reserve_1 = checked_add(pool.reserve_1, deposited_1)
    pool.lp_supply = checked_add(pool.lp_supply, lp_to_mint)
    
    serialize(pool, accounts.pool_state.data)
```

---

### 5.4 Instruction: `remove_liquidity` (Opcode 0x03)

Burns LP tokens and returns the user's proportional share of both pool reserves.

#### Mathematical Formulas & Rounding Rules

$$\text{amount}_0 = \left\lfloor \frac{\text{lp\_burned} \cdot \text{reserve}_0}{\text{lp\_supply}} \right\rfloor$$
$$\text{amount}_1 = \left\lfloor \frac{\text{lp\_burned} \cdot \text{reserve}_1}{\text{lp\_supply}} \right\rfloor$$
$$\text{assert}(\text{amount}_0 \ge \text{minimum\_amount\_0} \quad \text{and} \quad \text{amount}_1 \ge \text{minimum\_amount\_1})$$

Amounts returned round **DOWN** (truncating division) to preserve remaining reserves for existing liquidity providers per [Fee and Rounding Specification](fee-and-rounding-spec.md) §4.

#### Accounts Required

```
0.  [WRITE, SIGNER] user: Liquidity provider & signer
1.  []              global_config: PDA ["omnifi-config"]
2.  [WRITE]         pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
3.  []              pool_authority: PDA ["omnifi-authority", pool_state]
4.  [WRITE]         token_vault_0: Vault token 0 account
5.  [WRITE]         token_vault_1: Vault token 1 account
6.  [WRITE]         lp_mint: Pool LP token mint
7.  [WRITE]         user_lp: LP token account to burn from
8.  [WRITE]         user_token_0: Recipient token 0 account
9.  [WRITE]         user_token_1: Recipient token 1 account
10. []              token_program_0: Token Program ID for token 0
11. []              token_program_1: Token Program ID for token 1
12. []              lp_token_program: Classic SPL Token Program ID
```

#### Instruction Data

```
struct RemoveLiquidityData {
    discriminator: u8,          // 0x03
    lp_amount_to_burn: u64,     // Amount of LP tokens to burn
    minimum_amount_0: u64,      // Slippage guard: minimum token 0 received
    minimum_amount_1: u64,      // Slippage guard: minimum token 1 received
}
```

#### Execution Pseudocode

```
function process_remove_liquidity(accounts, data):
    assert(accounts.user.is_signer, ErrorCode.MissingRequiredSigner)
    assert(data.lp_amount_to_burn > 0, ErrorCode.ZeroWithdrawAmount)
    
    // 1. Verify GlobalConfig and Pool status
    config = deserialize_config(accounts.global_config)
    assert(!config.emergency_paused, ErrorCode.ProtocolEmergencyPaused)
    
    pool = deserialize_pool(accounts.pool_state)
    assert(!pool.is_paused, ErrorCode.PoolPaused)
    assert(data.lp_amount_to_burn <= pool.lp_supply, ErrorCode.BurnExceedsSupply)
    
    // 2. Validate PDA derivations & Vaults
    (expected_auth, auth_bump) = derive_pda([b"omnifi-authority", accounts.pool_state.key.as_ref()], PROGRAM_ID)
    assert(accounts.pool_authority.key == expected_auth, ErrorCode.InvalidAuthorityAddress)
    assert(accounts.lp_mint.key == pool.lp_mint, ErrorCode.InvalidLpMint)
    verify_vault(accounts.token_vault_0, pool.token_mint_0, expected_auth)
    verify_vault(accounts.token_vault_1, pool.token_mint_1, expected_auth)
    
    // 3. Compute proportional payout (round down)
    amount_0 = u64((u128(data.lp_amount_to_burn) * u128(pool.reserve_0)) / u128(pool.lp_supply))
    amount_1 = u64((u128(data.lp_amount_to_burn) * u128(pool.reserve_1)) / u128(pool.lp_supply))
    
    assert(amount_0 > 0 && amount_1 > 0, ErrorCode.ZeroWithdrawOutput)
    
    // 4. Slippage enforcement
    assert(amount_0 >= data.minimum_amount_0, ErrorCode.ExceededSlippageTolerance)
    assert(amount_1 >= data.minimum_amount_1, ErrorCode.ExceededSlippageTolerance)
    
    // 5. Burn LP tokens from user account
    cpi_burn(
        mint: accounts.lp_mint,
        from: accounts.user_lp,
        amount: data.lp_amount_to_burn,
        authority: accounts.user,
        program: accounts.lp_token_program
    )
    
    // 6. Transfer token 0 from vault 0 to user (signed by Pool Authority PDA)
    cpi_transfer_checked_out(
        from: accounts.token_vault_0,
        to: accounts.user_token_0,
        mint: pool.token_mint_0,
        amount: amount_0,
        authority: accounts.pool_authority,
        signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
        program: accounts.token_program_0
    )
    
    // 7. Transfer token 1 from vault 1 to user
    cpi_transfer_checked_out(
        from: accounts.token_vault_1,
        to: accounts.user_token_1,
        mint: pool.token_mint_1,
        amount: amount_1,
        authority: accounts.pool_authority,
        signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
        program: accounts.token_program_1
    )
    
    // 8. Update pool reserves and LP supply
    pool.reserve_0 = checked_sub(pool.reserve_0, amount_0)
    pool.reserve_1 = checked_sub(pool.reserve_1, amount_1)
    pool.lp_supply = checked_sub(pool.lp_supply, data.lp_amount_to_burn)
    
    serialize(pool, accounts.pool_state.data)
```

---

### 5.5 Instruction: `swap` (Exact Input, Opcode 0x04)

Executes a constant-product token swap given an exact input amount, enforcing fee-on-input, protocol fee diversion, and slippage protection.

#### Mathematical Formulas & Rounding Rules

1. **Fee-on-Input Calculation:**
   $$\text{total\_fee} = \left\lceil \frac{\text{amount\_in} \cdot \text{fee\_tier}}{1{,}000{,}000} \right\rceil = \left\lfloor \frac{\text{amount\_in} \cdot \text{fee\_tier} + 999{,}999}{1{,}000{,}000} \right\rfloor$$
   $$\text{amount\_in\_after\_fee} = \text{amount\_in} - \text{total\_fee}$$
   *Rounding:* Fee rounds **UP** (ceiling division) to prevent fee extraction via micro-swaps.

2. **Output Amount Calculation:**
   $$\text{numerator} = \text{reserve\_out} \cdot \text{amount\_in\_after\_fee}$$
   $$\text{denominator} = \text{reserve\_in} + \text{amount\_in\_after\_fee}$$
   $$\text{amount\_out} = \left\lfloor \frac{\text{numerator}}{\text{denominator}} \right\rfloor$$
   $$\text{assert}(\text{amount\_out} \ge \text{minimum\_amount\_out})$$
   *Rounding:* Output rounds **DOWN** (truncating division) to conserve pool reserves.

3. **Protocol Fee Split:**
   $$\text{protocol\_fee} = \left\lfloor \frac{\text{total\_fee} \cdot \text{protocol\_fee\_fraction}}{4} \right\rfloor$$
   $$\text{lp\_fee} = \text{total\_fee} - \text{protocol\_fee}$$
   *Rounding:* Protocol fee rounds **DOWN**, favoring liquidity providers per [ADR-007](../adr/ADR-007-economic-parameters.md).

4. **Reserve State Transition:**
   $$\text{reserve\_in}_{\text{new}} = \text{reserve\_in} + \text{amount\_in} - \text{protocol\_fee}$$
   $$\text{reserve\_out}_{\text{new}} = \text{reserve\_out} - \text{amount\_out}$$
   $$\text{protocol\_fees\_in}_{\text{new}} = \text{protocol\_fees\_in} + \text{protocol\_fee}$$

#### Accounts Required

```
0.  [WRITE, SIGNER] user: Trader & fee payer
1.  []              global_config: PDA ["omnifi-config"]
2.  [WRITE]         pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
3.  []              pool_authority: PDA ["omnifi-authority", pool_state]
4.  [WRITE]         token_vault_in: Vault receiving the input token
5.  [WRITE]         token_vault_out: Vault disbursing the output token
6.  [WRITE]         user_token_in: User source token account
7.  [WRITE]         user_token_out: User destination token account
8.  []              token_program_in: Token Program ID for input token
9.  []              token_program_out: Token Program ID for output token
```

#### Instruction Data

```
struct SwapData {
    discriminator: u8,          // 0x04
    amount_in: u64,             // Exact quantity of input token
    minimum_amount_out: u64,    // Slippage guard: minimum acceptable output
}
```

#### Execution Pseudocode

```
function process_swap(accounts, data):
    assert(accounts.user.is_signer, ErrorCode.MissingRequiredSigner)
    assert(data.amount_in > 0, ErrorCode.ZeroSwapInput)
    
    // 1. Verify GlobalConfig and Pool status
    config = deserialize_config(accounts.global_config)
    assert(!config.emergency_paused, ErrorCode.ProtocolEmergencyPaused)
    
    pool = deserialize_pool(accounts.pool_state)
    assert(!pool.is_paused, ErrorCode.PoolPaused)
    
    // 2. Validate PDA derivations
    (expected_auth, auth_bump) = derive_pda([b"omnifi-authority", accounts.pool_state.key.as_ref()], PROGRAM_ID)
    assert(accounts.pool_authority.key == expected_auth, ErrorCode.InvalidAuthorityAddress)
    
    // 3. Determine swap direction and assign active reserves
    var is_token_0_in: bool = false
    var reserve_in: u64 = 0
    var reserve_out: u64 = 0
    
    if accounts.token_vault_in.mint == pool.token_mint_0:
        is_token_0_in = true
        reserve_in = pool.reserve_0
        reserve_out = pool.reserve_1
        verify_vault(accounts.token_vault_in, pool.token_mint_0, expected_auth)
        verify_vault(accounts.token_vault_out, pool.token_mint_1, expected_auth)
    else if accounts.token_vault_in.mint == pool.token_mint_1:
        is_token_0_in = false
        reserve_in = pool.reserve_1
        reserve_out = pool.reserve_0
        verify_vault(accounts.token_vault_in, pool.token_mint_1, expected_auth)
        verify_vault(accounts.token_vault_out, pool.token_mint_0, expected_auth)
    else:
        panic(ErrorCode.InvalidVaultAccount)
        
    assert(reserve_in > 0 && reserve_out > 0, ErrorCode.InsufficientPoolLiquidity)
    
    // 4. Compute fee-on-input (round UP)
    // total_fee = ceil_div(amount_in * fee_tier, 1_000_000)
    fee_product = u128(data.amount_in) * u128(pool.fee_tier)
    total_fee = u64((fee_product + 999_999) / 1_000_000)
    assert(data.amount_in > total_fee, ErrorCode.FeeExceedsInput)
    
    amount_in_after_fee = data.amount_in - total_fee
    
    // 5. Compute output amount (round DOWN)
    numerator = u128(reserve_out) * u128(amount_in_after_fee)
    denominator = u128(reserve_in) + u128(amount_in_after_fee)
    amount_out = u64(numerator / denominator)
    
    assert(amount_out > 0, ErrorCode.ZeroSwapOutput)
    assert(amount_out < reserve_out, ErrorCode.InsufficientPoolReserve)
    
    // 6. Slippage validation
    assert(amount_out >= data.minimum_amount_out, ErrorCode.ExceededSlippageTolerance)
    
    // 7. Protocol fee calculation (round DOWN)
    protocol_fee: u64 = 0
    if config.protocol_fee_fraction > 0:
        protocol_fee = u64((u128(total_fee) * u128(config.protocol_fee_fraction)) / 4)
    
    // 8. Invariant sanity check: invariant must strictly not decrease
    // (reserve_in + amount_in_after_fee) * (reserve_out - amount_out) >= reserve_in * reserve_out
    k_before = u128(reserve_in) * u128(reserve_out)
    k_after = u128(reserve_in + amount_in_after_fee) * u128(reserve_out - amount_out)
    assert(k_after >= k_before, ErrorCode.InvariantViolation)
    
    // 9. Transfer input tokens into vault
    actual_received_in = cpi_transfer_checked_in(
        from: accounts.user_token_in,
        to: accounts.token_vault_in,
        mint: accounts.token_vault_in.mint,
        amount: data.amount_in,
        authority: accounts.user,
        program: accounts.token_program_in
    )
    
    // 10. Transfer output tokens to trader (signed by Pool Authority PDA)
    cpi_transfer_checked_out(
        from: accounts.token_vault_out,
        to: accounts.user_token_out,
        mint: accounts.token_vault_out.mint,
        amount: amount_out,
        authority: accounts.pool_authority,
        signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
        program: accounts.token_program_out
    )
    
    // 11. State updates
    if is_token_0_in:
        pool.reserve_0 = checked_add(pool.reserve_0, (actual_received_in - protocol_fee))
        pool.reserve_1 = checked_sub(pool.reserve_1, amount_out)
        pool.protocol_fees_0 = checked_add(pool.protocol_fees_0, protocol_fee)
    else:
        pool.reserve_1 = checked_add(pool.reserve_1, (actual_received_in - protocol_fee))
        pool.reserve_0 = checked_sub(pool.reserve_0, amount_out)
        pool.protocol_fees_1 = checked_add(pool.protocol_fees_1, protocol_fee)
        
    serialize(pool, accounts.pool_state.data)
```

---

### 5.6 Instruction: `collect_protocol_fees` (Opcode 0x05)

Transfers accumulated protocol fees from pool vaults to the protocol fee recipient. Restrictive access: callable only by `fee_authority` designated in `GlobalConfig`.

#### Accounts Required

```
0.  [SIGNER]        fee_authority: Must match GlobalConfig.fee_authority
1.  []              global_config: PDA ["omnifi-config"]
2.  [WRITE]         pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
3.  []              pool_authority: PDA ["omnifi-authority", pool_state]
4.  [WRITE]         token_vault_0: Vault token 0
5.  [WRITE]         token_vault_1: Vault token 1
6.  [WRITE]         recipient_token_0: Fee treasury token 0 account
7.  [WRITE]         recipient_token_1: Fee treasury token 1 account
8.  []              token_program_0: Token Program ID for token 0
9.  []              token_program_1: Token Program ID for token 1
```

#### Instruction Data

```
struct CollectProtocolFeesData {
    discriminator: u8,          // 0x05
}
```

#### Execution Pseudocode

```
function process_collect_protocol_fees(accounts, data):
    assert(accounts.fee_authority.is_signer, ErrorCode.MissingRequiredSigner)
    
    config = deserialize_config(accounts.global_config)
    assert(accounts.fee_authority.key == config.fee_authority, ErrorCode.UnauthorizedFeeAuthority)
    
    pool = deserialize_pool(accounts.pool_state)
    (expected_auth, auth_bump) = derive_pda([b"omnifi-authority", accounts.pool_state.key.as_ref()], PROGRAM_ID)
    assert(accounts.pool_authority.key == expected_auth, ErrorCode.InvalidAuthorityAddress)
    
    claim_0 = pool.protocol_fees_0
    claim_1 = pool.protocol_fees_1
    assert(claim_0 > 0 || claim_1 > 0, ErrorCode.NoProtocolFeesToCollect)
    
    // Transfer token 0 protocol fees if any
    if claim_0 > 0:
        cpi_transfer_checked_out(
            from: accounts.token_vault_0,
            to: accounts.recipient_token_0,
            mint: pool.token_mint_0,
            amount: claim_0,
            authority: accounts.pool_authority,
            signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
            program: accounts.token_program_0
        )
        pool.protocol_fees_0 = 0
        
    // Transfer token 1 protocol fees if any
    if claim_1 > 0:
        cpi_transfer_checked_out(
            from: accounts.token_vault_1,
            to: accounts.recipient_token_1,
            mint: pool.token_mint_1,
            amount: claim_1,
            authority: accounts.pool_authority,
            signer_seeds: [b"omnifi-authority", accounts.pool_state.key.as_ref(), [auth_bump]],
            program: accounts.token_program_1
        )
        pool.protocol_fees_1 = 0
        
    serialize(pool, accounts.pool_state.data)
```

---

### 5.7 Instruction: `update_config` (Opcode 0x06)

Updates administrative parameters in `GlobalConfig`. Requires `authority` multisig signature.

#### Accounts Required

```
0. [SIGNER] authority: Must match GlobalConfig.authority (Squads 3-of-5 multisig)
1. [WRITE]  global_config: PDA ["omnifi-config"]
```

#### Instruction Data

```
struct UpdateConfigData {
    discriminator: u8,                    // 0x06
    new_authority: Option<Pubkey>,        // Optional replacement admin
    new_fee_authority: Option<Pubkey>,    // Optional replacement fee recipient
    new_protocol_fee_fraction: Option<u8>,// 0 or 1
    new_emergency_paused: Option<bool>,   // Global freeze toggle
}
```

#### Execution Pseudocode

```
function process_update_config(accounts, data):
    assert(accounts.authority.is_signer, ErrorCode.MissingRequiredSigner)
    
    config = deserialize_config(accounts.global_config)
    assert(accounts.authority.key == config.authority, ErrorCode.UnauthorizedAdmin)
    
    if data.new_authority.is_some():
        config.authority = data.new_authority.unwrap()
        
    if data.new_fee_authority.is_some():
        config.fee_authority = data.new_fee_authority.unwrap()
        
    if data.new_protocol_fee_fraction.is_some():
        frac = data.new_protocol_fee_fraction.unwrap()
        assert(frac <= 1, ErrorCode.InvalidFeeParameter)
        config.protocol_fee_fraction = frac
        
    if data.new_emergency_paused.is_some():
        config.emergency_paused = data.new_emergency_paused.unwrap()
        
    serialize(config, accounts.global_config.data)
```

---

### 5.8 Instruction: `set_pool_pause` (Opcode 0x07)

Provides targeted operational pauses for individual pools without freezing the entire protocol. Requires `authority` multisig.

#### Accounts Required

```
0. [SIGNER] authority: Must match GlobalConfig.authority
1. []       global_config: PDA ["omnifi-config"]
2. [WRITE]  pool_state: PDA ["omnifi-pool", mint0, mint1, fee_tier_le]
```

#### Instruction Data

```
struct SetPoolPauseData {
    discriminator: u8,     // 0x07
    is_paused: bool,       // true to pause, false to unpause
}
```

---

## 6. §5: Validation Requirements & Security Controls

Every instruction processes untrusted account inputs. The program enforces an exhaustive validation pipeline in strict sequence:

```
+-----------------------------------------------------------------------------------------------+
|                               Instruction Validation Pipeline                                 |
+-----------------------------------------------------------------------------------------------+
|  1. Signer Verification      -> Assert all required signers have signed                       |
|  2. Program ID Assertions    -> Verify System, Token, ATA, Rent program IDs                   |
|  3. Account Ownership        -> Verify OmniFi-owned state and Token-owned vaults              |
|  4. PDA & Bump Derivation    -> Recompute expected PDAs and compare against supplied keys     |
|  5. Relationship Validation  -> Verify Vaults match pool mints and authority                  |
|  6. Operational Status       -> Check GlobalConfig.emergency_paused and PoolState.is_paused   |
|  7. Parameter & Anti-Aliasing-> Check math bounds, slippage limits, and duplicate accounts     |
+-----------------------------------------------------------------------------------------------+
```

### 6.1 Program IDs and Sysvar Verification

All program IDs passed into instruction account arrays must match known hardcoded public keys:
- System Program: `11111111111111111111111111111111`
- Classic SPL Token Program: `TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA`
- Token-2022 Program: `TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb`
- Associated Token Program: `ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL`
- Rent Sysvar: `SysvarRent111111111111111111111111111111111`

### 6.2 Account Ownership Verification

- `GlobalConfig` and `PoolState` accounts must have `account.owner == PROGRAM_ID`.
- Token accounts (`token_vault_0`, `token_vault_1`, `lp_mint`, `user_token_in`, `user_token_out`, `user_lp`) must have their `account.owner` equal to either `SPL_TOKEN_PROGRAM_ID` or `TOKEN_2022_PROGRAM_ID`.

### 6.3 PDA Derivations and Bumps

Every PDA supplied to an instruction must be independently re-derived:
1. `GlobalConfig`: `assert(accounts.global_config.key == derive_pda([b"omnifi-config"], PROGRAM_ID))`
2. `PoolState`: `assert(accounts.pool_state.key == derive_pda([b"omnifi-pool", mint0, mint1, fee_tier_le], PROGRAM_ID))`
3. `Pool Authority PDA`: `assert(accounts.pool_authority.key == derive_pda([b"omnifi-authority", pool_state.key], PROGRAM_ID))`

### 6.4 Vault Authority and Mint Matching

For all operations accessing `token_vault_0` and `token_vault_1`:
- `vault_0.mint == pool_state.token_mint_0`
- `vault_1.mint == pool_state.token_mint_1`
- `vault_0.owner == pool_authority_pda`
- `vault_1.owner == pool_authority_pda`
- `lp_mint.mint_authority == pool_authority_pda`

### 6.5 Account Anti-Aliasing and Duplication Checks

To prevent account confusion or double-counting exploits (Threat Vector `SOL3` per [Solana Threat Model](../security/threat-model-solana.md)):
- `accounts.token_mint_0.key != accounts.token_mint_1.key`
- `accounts.token_vault_0.key != accounts.token_vault_1.key`
- `accounts.user_token_in.key != accounts.token_vault_in.key`
- `accounts.user_token_out.key != accounts.token_vault_out.key`
- `accounts.pool_state.key != accounts.global_config.key`

### 6.6 Arithmetic Bounds and Overflow Protection

- All additions, subtractions, and multiplications use checked integer arithmetic (`checked_add`, `checked_sub`, `checked_mul`).
- Products of two `u64` values (e.g., $x \cdot y$ or $\text{amount} \cdot \text{reserve}$) must be computed within `u128` registers.
- Divisors are explicitly asserted to be non-zero before division.

---

## 7. §6: Token Program Compatibility (SPL & Token-2022)

Per [ADR-006 (Token Policy)](../adr/ADR-006-token-policy.md) and [Token Compatibility Specification](../security/token-compatibility.md), OmniFi supports both the classic SPL Token program and the Token-2022 program.

### 7.1 Multi-Program Support Pattern

The AMM program accepts explicit `token_program` accounts for each token in the pool:
- A pool may pair two classic SPL tokens.
- A pool may pair two Token-2022 tokens.
- A pool may pair a classic SPL token with a Token-2022 token.

The instruction accounts provide `token_program_0` and `token_program_1` matching the program owning `token_mint_0` and `token_mint_1` respectively.

### 7.2 Token-2022 Extension Support Matrix

| Extension | Support Status | Program Action |
|-----------|:--------------:|----------------|
| **Transfer Fee** | ⚠️ Conditionally Supported | Supported via balance-delta checks or extension introspection. Pool accounts for actual tokens received. |
| **Metadata / Pointer** | ✅ Supported | Read-only display; program ignores metadata fields during execution. |
| **Transfer Hook** | 🚫 **BLOCKED (R1)** | Program checks mint extension list at `create_pool`. If transfer hook is present, creation is rejected. |
| **Permanent Delegate** | 🚫 **BLOCKED (R1)** | Rejected at `create_pool`. Prevents unauthorized drainage of vault reserves. |
| **Default Account State (Frozen)** | 🚫 **BLOCKED (R1)** | Rejected at `create_pool`. Prevents vault initialization freeze. |
| **Non-Transferable** | 🚫 **BLOCKED (R1)** | Rejected at `create_pool`. |
| **Interest-Bearing / Scaled UI** | 🚫 **BLOCKED (R1)** | Rejected at `create_pool`. Dynamic balances violate reserve invariance. |
| **Confidential Transfer** | 🚫 **BLOCKED (R1)** | Rejected at `create_pool`. AMM transparency requires plaintext amounts. |

### 7.3 Transfer-Fee Extension Handling

When a Token-2022 mint implements the Transfer-Fee extension, the token program withholds a fee upon every transfer. To guarantee accurate reserve accounting:
1. **Balance-Delta Measurement:**
   ```
   balance_before = get_token_balance(vault)
   cpi_transfer_checked(user, vault, amount)
   balance_after = get_token_balance(vault)
   
   actual_received = balance_after - balance_before
   assert(actual_received > 0, ErrorCode.TransferFeeConsumedEntireAmount)
   ```
2. **State Updates:** All pool calculations use `actual_received`, never the gross `amount` requested from the user.

---

## 8. §7: Compute-Unit (CU) Budget & Performance

Solana sets a default compute-unit limit of 200,000 CU per transaction instruction, with a hard maximum of 1,400,000 CU per transaction. OmniFi instructions are optimized to fit well within standard compute limits.

### 8.1 Instruction Budget Estimates

| Instruction | Estimated CU | Main Compute Consumers | Optimization Directives |
|-------------|:------------:|------------------------|-------------------------|
| `initialize_config` | ~10,000 | System Program `create_account`, Borsh serialization | Single write, minimal logic |
| `create_pool` | ~50,000 | 1 Account creation, 1 Mint creation, 2 ATA creations | Batch account creation CPIs |
| `add_liquidity` | ~30,000 | 2 Transfer CPIs, 1 Mint CPI, integer sqrt / checked math | Pre-derived bumps, zero-copy read |
| `remove_liquidity` | ~30,000 | 1 Burn CPI, 2 Transfer CPIs, checked division | Pre-derived bumps, cached state |
| `swap` | ~25,000 | 2 Transfer CPIs, fee-on-input math, invariant check | Zero-copy deserialization, single-pass CPI |
| `collect_fees` | ~25,000 | Up to 2 Transfer CPIs, auth validation | Skips zero-balance transfers |
| `update_config` | ~10,000 | Signer assertion, configuration overwrite | Minimal deserialization overhead |

### 8.2 Compute Breakdown for `swap`

```
Instruction Step                              Compute Units (CU)
----------------------------------------------------------------
1. Account deserialization & discriminator check           ~1,500
2. PDA derivation checks (stored bump)                     ~1,800
3. Vault & Mint address verification                       ~1,200
4. Checked integer fee & output calculation                 ~800
5. Invariant preservation check (u128 mul)                  ~400
6. Inbound Transfer CPI (invoke_signed)                   ~8,500
7. Outbound Transfer CPI (invoke_signed)                  ~8,500
8. State update & serialization                            ~1,500
9. Program log emission                                      ~800
----------------------------------------------------------------
Total Estimated Swap Cost:                                ~25,000 CU
```

---

## 9. §8: Account Lifecycle & Rent Exemption

### 9.1 Rent Exemption

All accounts created by the OmniFi AMM Program (`GlobalConfig`, `PoolState`, `LP Mint`, and `Token Vaults`) must be initialized with a lamport balance equal to or greater than the Solana runtime's minimum rent-exempt threshold:

$$\text{Lamports}_{\text{required}} = \text{Rent}::\text{get}()\text{.minimum\_balance}(\text{account\_size})$$

- At no point during protocol operation may an instruction deduct lamports from a protocol state account below this threshold.
- The `payer` account must fund rent-exemption at creation time.

### 9.2 Account Persistence

- **No Ephemeral Expiry:** `GlobalConfig` and `PoolState` accounts persist indefinitely.
- **Permanent State:** The presence of `MINIMUM_LIQUIDITY` (1000 base units locked at initialization) guarantees that `lp_supply` can never drop to zero after initial liquidity is added. Consequently, active pools cannot be drained completely or silently closed by users.

### 9.3 Decommissioning and Account Closure Semantics

In the event of an approved protocol migration or pool retirement:
1. **Prerequisite Conditions for Pool Closure:**
   - Both token vaults must be empty (`vault_0.amount == 0` and `vault_1.amount == 0`).
   - All circulating LP tokens must have been redeemed (except the permanently locked `MINIMUM_LIQUIDITY`).
   - The pool must be explicitly marked for decommissioning by the multisig `authority`.
2. **Safe Rent Reclamation:**
   - When closing an authorized empty account, the program zeroizes the data buffer to prevent resurrection attacks (`account.data.fill(0)`).
   - Reclaimed rent lamports are directed strictly to `GlobalConfig.authority` (the protocol multisig treasury), **never** to an arbitrary or user-specified recipient:
     ```
     destination_lamports = checked_add(authority.lamports, pool_account.lamports)
     authority.set_lamports(destination_lamports)
     pool_account.set_lamports(0)
     pool_account.assign(SYSTEM_PROGRAM_ID)
     ```

---

## 10. §9: Program Error Codes & Event Logging

### 10.1 Program Error Codes

The program returns a deterministic 32-bit custom error code upon validation failure:

| Code (Hex) | Name | Description |
|:----------:|------|-------------|
| `0x1770` (6000) | `InvalidAccountDiscriminator` | Account discriminator does not match expected byte |
| `0x1771` (6001) | `AccountAlreadyInitialized` | Account is already populated with data |
| `0x1772` (6002) | `MissingRequiredSigner` | Instruction requires a signature that was not provided |
| `0x1773` (6003) | `InvalidProgramId` | Account passed for external program ID does not match expected |
| `0x1774` (6004) | `InvalidPdaAddress` | Supplied PDA address does not match canonical derivation |
| `0x1775` (6005) | `InvalidPdaBump` | Provided bump seed is invalid or off-curve |
| `0x1776` (6006) | `ProtocolEmergencyPaused` | Action blocked by global protocol emergency pause |
| `0x1777` (6007) | `PoolPaused` | Action blocked by individual pool pause flag |
| `0x1778` (6008) | `TokensNotSorted` | Token mints are not ordered canonically (`mint_0 < mint_1`) |
| `0x1779` (6009) | `IdenticalTokenMints` | Both tokens in the pair have identical mint addresses |
| `0x177A` (6010) | `InvalidFeeTier` | Fee tier is not one of 100, 500, 3000, 10000 |
| `0x177B` (6011) | `InvalidFeeParameter` | Protocol fee fraction parameter exceeds allowable bounds |
| `0x177C` (6012) | `PoolAlreadyExists` | A pool for this token pair and fee tier already exists |
| `0x177D` (6013) | `InvalidAuthorityAddress` | Pool authority account does not match canonical derivation |
| `0x177E` (6014) | `InvalidVaultAccount` | Vault account does not match expected mint or authority |
| `0x177F` (6015) | `InvalidLpMint` | LP mint does not match address stored in PoolState |
| `0x1780` (6016) | `UnauthorizedAdmin` | Signer does not match GlobalConfig admin authority |
| `0x1781` (6017) | `UnauthorizedFeeAuthority` | Signer does not match GlobalConfig fee authority |
| `0x1782` (6018) | `UnsupportedTokenExtension` | Token-2022 mint utilizes a blocked extension |
| `0x1783` (6019) | `ZeroDepositAmount` | Liquidity deposit amounts must be greater than zero |
| `0x1784` (6020) | `InitialLiquidityTooLow` | Initial deposit must exceed MINIMUM_LIQUIDITY (1000) |
| `0x1785` (6021) | `ZeroLpMinted` | Calculated LP tokens to mint is zero |
| `0x1786` (6022) | `ExceededSlippageTolerance` | Returned shares or output tokens are below minimum limit |
| `0x1787` (6023) | `ZeroWithdrawAmount` | LP amount to burn must be greater than zero |
| `0x1788` (6024) | `BurnExceedsSupply` | LP amount to burn exceeds total circulating LP supply |
| `0x1789` (6025) | `ZeroWithdrawOutput` | Liquidity withdrawal produced zero output tokens |
| `0x178A` (6026) | `ZeroSwapInput` | Swap input amount must be greater than zero |
| `0x178B` (6027) | `ZeroSwapOutput` | Calculated swap output tokens is zero |
| `0x178C` (6028) | `FeeExceedsInput` | Fee calculation matches or exceeds input amount |
| `0x178D` (6029) | `InsufficientPoolReserve` | Requested swap output exceeds available pool reserve |
| `0x178E` (6030) | `InsufficientPoolLiquidity` | Pool has zero reserves and cannot execute swaps |
| `0x178F` (6031) | `InvariantViolation` | Swap calculation would decrease constant-product invariant |
| `0x1790` (6032) | `NoProtocolFeesToCollect` | Pool has no uncollected protocol fees |
| `0x1791` (6033) | `AliasedAccounts` | Duplicate or aliased accounts passed to instruction |
| `0x1792` (6034) | `TransferFeeConsumedEntireAmount` | Token-2022 transfer fee consumed the entire amount |

---

### 10.2 Event Logging Format

OmniFi emits structured program log messages (`msg!`) using standard Base64-encoded binary structures or standardized JSON strings for reliable off-chain indexer consumption:

#### 1. Swap Event

```json
{
  "event": "Swap",
  "pool": "Pubkey",
  "trader": "Pubkey",
  "token_in": "Pubkey",
  "token_out": "Pubkey",
  "amount_in": "u64",
  "amount_out": "u64",
  "lp_fee": "u64",
  "protocol_fee": "u64",
  "reserve_0_after": "u64",
  "reserve_1_after": "u64"
}
```

#### 2. Liquidity Event

```json
{
  "event": "LiquidityChange",
  "pool": "Pubkey",
  "provider": "Pubkey",
  "is_addition": "bool",
  "amount_0": "u64",
  "amount_1": "u64",
  "lp_shares": "u64",
  "total_lp_supply": "u64"
}
```

---

## 11. §10: Client Derivation & SDK Guide

Clients, SDKs, and routers must derive all necessary program addresses deterministically without making multiple RPC calls.

### 11.1 Address Derivation Helper (TypeScript Pseudocode)

```typescript
import { PublicKey } from "@solana/web3.js";

export const OMNIFI_PROGRAM_ID = new PublicKey("OmniFiAMM11111111111111111111111111111111111");

/**
 * Derives the canonical GlobalConfig PDA.
 */
export function getGlobalConfigAddress(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("omnifi-config")],
    OMNIFI_PROGRAM_ID
  );
}

/**
 * Sorts two mints canonically by raw 32-byte representation.
 */
export function sortMints(mintA: PublicKey, mintB: PublicKey): [PublicKey, PublicKey] {
  const cmp = Buffer.compare(mintA.toBuffer(), mintB.toBuffer());
  if (cmp === 0) {
    throw new Error("Identical token mints not allowed");
  }
  return cmp < 0 ? [mintA, mintB] : [mintB, mintA];
}

/**
 * Derives the canonical PoolState PDA for a given pair and fee tier.
 */
export function getPoolStateAddress(
  mintA: PublicKey,
  mintB: PublicKey,
  feeTier: number
): [PublicKey, number] {
  const [mint0, mint1] = sortMints(mintA, mintB);
  const feeBuffer = Buffer.alloc(4);
  feeBuffer.writeUInt32LE(feeTier, 0);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("omnifi-pool"), mint0.toBuffer(), mint1.toBuffer(), feeBuffer],
    OMNIFI_PROGRAM_ID
  );
}

/**
 * Derives the Pool Authority PDA for signing CPI transfers.
 */
export function getPoolAuthorityAddress(poolState: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("omnifi-authority"), poolState.toBuffer()],
    OMNIFI_PROGRAM_ID
  );
}
```

### 11.2 Swap Quote Simulation Helper

```typescript
/**
 * Computes estimated swap output and fee breakdown off-chain.
 * Matches on-chain integer math exactly.
 */
export function computeSwapQuote(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
  feeTier: number,
  protocolFeeFraction: number // 0 or 1
): {
  amountOut: bigint;
  lpFee: bigint;
  protocolFee: bigint;
  priceImpactBps: number;
} {
  if (amountIn <= 0n) throw new Error("Amount in must be > 0");
  if (reserveIn <= 0n || reserveOut <= 0n) throw new Error("Insufficient liquidity");

  // Fee-on-input: ceil(amountIn * feeTier / 1_000_000)
  const feeTierBig = BigInt(feeTier);
  const totalFee = (amountIn * feeTierBig + 999_999n) / 1_000_000n;
  const amountInAfterFee = amountIn - totalFee;

  // Constant-product output: floor((reserveOut * amountInAfterFee) / (reserveIn + amountInAfterFee))
  const numerator = reserveOut * amountInAfterFee;
  const denominator = reserveIn + amountInAfterFee;
  const amountOut = numerator / denominator;

  // Protocol fee split: floor(totalFee * protocolFeeFraction / 4)
  const protocolFee = (totalFee * BigInt(protocolFeeFraction)) / 4n;
  const lpFee = totalFee - protocolFee;

  // Price impact calculation: (ideal_out - actual_out) / ideal_out
  const idealOut = (reserveOut * amountIn) / reserveIn;
  const impact = Number((idealOut - amountOut) * 10000n / idealOut);

  return {
    amountOut,
    lpFee,
    protocolFee,
    priceImpactBps: Math.max(0, impact)
  };
}
```

---

## 12. Verification and Acceptance Checklist

- [x] State accounts are natively decoupled and use Solana's account model rather than an EVM port.
- [x] All accounts (`GlobalConfig`, `PoolState`, `Pool Authority PDA`, Vaults, LP Mint) have explicit fields, byte offsets, and deterministic sizes specified.
- [x] PDA derivation seeds strictly use namespace prefix `omnifi-` and store bumps for compute optimization.
- [x] Canonical token ordering (`token_mint_0 < token_mint_1`) enforced by byte comparison.
- [x] Mathematical equations for swap, liquidity addition, and liquidity removal use integer floor/ceiling division in exact alignment with [Fee and Rounding Specification](fee-and-rounding-spec.md).
- [x] Token-2022 compatibility matrix enforces R1 safety policy: Transfer Fees supported, Transfer Hooks and dangerous extensions strictly blocked.
- [x] Compute units are budgeted and broken down per instruction.
- [x] Account lifecycle defines permanent rent exemption, decommissioning constraints, and rent destination protections.
