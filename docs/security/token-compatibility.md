# OmniFi — Token Compatibility Specification

**Version:** 1.0  
**Status:** Phase 1 deliverable  
**Date:** 2026-11-01  
**Related ADRs:** ADR-006 (Accepted — Tiered policy)

---

## 1. Token Risk Tiers

| Tier | Label | UI Treatment | Pool Eligibility |
|------|-------|-------------|-----------------|
| **Verified** | ✅ Green checkmark | Normal display | Full support |
| **Unverified** | ⚠️ Yellow warning | Warning banner: "This token has not been reviewed" | Allowed with warning |
| **Blocked** | 🚫 Blocked | Cannot be selected | Rejected — not routable |

## 2. EVM Token Classification

### 2.1 Supported (Verified eligible)

| Behavior | Classification | Notes |
|----------|---------------|-------|
| Standard ERC-20 | ✅ Supported | `transfer` returns `true`, no fee-on-transfer, no rebase |
| No-return-value transfer | ✅ Supported | Use `SafeTransferLib` — handles tokens that don't return bool |
| Non-standard decimals (e.g., 6, 8) | ✅ Supported | Decimals read from contract and validated |

### 2.2 Conditionally Supported (Requires explicit handling)

| Behavior | Classification | Handling |
|----------|---------------|---------|
| Fee-on-transfer tokens | ⚠️ Conditional | Balance-before/after check. Pool must account for actual received amount. Quote engine must estimate fee. Router uses `amountOutMin` protection. |
| Pausable tokens (e.g., USDT) | ⚠️ Conditional | Supported when unpaused. Pool operations will revert if token is paused — expected behavior. |
| Tokens with blacklist (e.g., USDC) | ⚠️ Conditional | Supported for non-blacklisted addresses. If pool address is blacklisted, pool becomes inoperable — risk documented. |

### 2.3 Blocked (R1)

| Behavior | Classification | Rationale |
|----------|---------------|-----------|
| Rebasing tokens | 🚫 Blocked | Balance changes break reserve accounting |
| Tokens with transfer hooks/callbacks | 🚫 Blocked | Reentrancy risk; requires v4 hook system |
| Upgradeable proxy tokens (unreviewed) | 🚫 Blocked | Implementation can change behavior |
| Tokens with > 18 decimals | 🚫 Blocked | Overflow risk in price calculations |
| Tokens with 0 decimals | ⚠️ Case-by-case | May cause dust/rounding issues |

### 2.4 Validation Requirements (EVM)

Every token interaction must:
1. Use `SafeTransferLib` for `transfer` and `transferFrom`
2. Validate `decimals()` call succeeds and returns a sane value (0–18)
3. For fee-on-transfer: compare balance before/after transfer
4. Never trust `symbol()` or `name()` as identity — use checksummed address + chain ID
5. Verify token is not on the blocklist before routing

## 3. Solana Token Classification

### 3.1 Supported

| Program | Classification | Notes |
|---------|---------------|-------|
| SPL Token (classic) | ✅ Supported | Standard token program |
| Token-2022 (base) | ✅ Supported | Validate program ID explicitly |

### 3.2 Token-2022 Extension Policy

| Extension | Classification | Handling |
|-----------|---------------|---------|
| Transfer Fee | ⚠️ Conditional | Fee must be accounted for in swap amounts. Quote engine reads fee config. Pool program validates actual received. |
| Permanent Delegate | 🚫 Blocked | Delegate can drain tokens from any account |
| Default Account State (frozen) | 🚫 Blocked | New token accounts created frozen — unusable |
| Non-Transferable | 🚫 Blocked | Cannot be swapped by definition |
| Transfer Hook | 🚫 Blocked (R1) | Arbitrary code execution risk. Requires dedicated review. |
| Interest-Bearing | 🚫 Blocked | Balance changes break accounting |
| Confidential Transfer | 🚫 Blocked | Incompatible with AMM transparency requirements |
| Metadata | ✅ Supported | Display-only, not trusted for identity |
| Mint Close Authority | ⚠️ Conditional | Mint can be closed — verify mint is active |
| Freeze Authority | ⚠️ Conditional | Authority can freeze pool token accounts — risk documented |

### 3.3 Validation Requirements (Solana)

Every token interaction must:
1. Validate token program ID (`TokenkegQEcnVF...` or `TokenzQdBN...`)
2. Validate mint address matches pool configuration
3. Validate token account owner and authority
4. Check for unsupported extensions on Token-2022 mints
5. For transfer-fee extension: read fee config and adjust amounts
6. Never trust metadata (name, symbol, URI) as identity

## 4. Token Registry Schema

```typescript
interface TokenEntry {
  // Identity (unique key)
  namespace: 'eip155' | 'solana';
  networkKey: string;           // e.g., 'ethereum-sepolia'
  address: string;              // Checksummed (EVM) or base58 (Solana)

  // Classification
  tokenProgram?: string;        // Solana: program ID
  standard: 'ERC20' | 'SPL' | 'Token2022';
  riskTier: 'verified' | 'unverified' | 'blocked';
  behaviors: TokenBehavior[];   // e.g., ['fee-on-transfer', 'pausable']

  // Metadata (display only — not trusted for identity)
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string;

  // Provenance
  source: string;               // Who added this entry
  verifiedAt?: string;          // ISO timestamp
  reviewedBy?: string;          // Reviewer identity
  version: number;              // Entry version for audit trail
}

type TokenBehavior =
  | 'standard'
  | 'no-return-value'
  | 'fee-on-transfer'
  | 'pausable'
  | 'blacklistable'
  | 'upgradeable-proxy'
  | 'rebasing'
  | 'transfer-fee-extension'
  | 'freeze-authority'
  | 'mint-close-authority';
```

## 5. Frontend Warning Rules

| Condition | Warning |
|-----------|---------|
| Token `riskTier === 'unverified'` | "This token has not been reviewed. Trade at your own risk." |
| Token has `fee-on-transfer` | "This token charges a fee on transfer. Actual received may differ from quote." |
| Token has `pausable` | "This token can be paused by its issuer." |
| Token has `blacklistable` | "This token has a blacklist. Your address could be blocked." |
| Token has `freeze-authority` (Solana) | "This token's freeze authority is active. Your tokens could be frozen." |
| Token not in registry | "Unknown token. Verify the contract address before trading." |

