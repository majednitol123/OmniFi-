# ADR-006: Token Policy

- Status: Accepted
- Date: 2026-11-01
- Owners: [Pending assignment]
- Related requirements: plan.md §11, §4.1, §10.1

## Context

OmniFi must define which token standards and behaviors are supported in Release 1 across EVM and Solana chains. Tokens are not uniform: they range from well-behaved standard implementations to adversarial or exotic variants that can break accounting invariants, drain LP funds, or cause unexpected reverts. A token policy determines what the protocol will accept, reject, or conditionally support — and how the frontend, SDK, and on-chain components enforce that boundary.

### Token landscape summary

**EVM risks:** fee-on-transfer (breaks accounting), rebasing (reserves diverge), pausable/blacklistable (unpredictable reverts), non-standard decimals, upgradeable proxies (behavior changes post-deploy), reentrant callbacks, no-return-value transfers.

**Solana risks:** Token-2022 extensions requiring explicit handling, transfer-fee (amount mismatch), transfer-hook (arbitrary CPI), permanent delegate (third-party burn/transfer), freeze authority, non-transferable tokens, confidential transfers (incompatible with public accounting).

## Decision drivers

- **Safety:** Incorrect token handling is a top-5 DeFi exploit category.
- **Usability:** Overly restrictive policies lock out legitimate tokens and reduce TVL.
- **Operational cost:** Each token behavior requires dedicated testing, monitoring, and support.
- **Regulatory signal:** Unverified tokens create legal and reputational risk.
- **Composability:** Integrators need predictable behavior and clear documentation.

## Options considered

### Option A: Support all detected tokens

**Description:** Accept any token that implements the expected interface. Attempt best-effort accounting for non-standard behaviors.

**Pros:**
- Maximum token coverage and TVL potential.
- No curation overhead.

**Cons:**
- Impossible to guarantee accounting correctness for all variants.
- Fee-on-transfer and rebasing tokens silently break reserves if not individually handled.
- Massively expanded attack surface.
- Audit scope becomes unbounded.
- User losses from exotic token bugs fall on the protocol's reputation.

### Option B: Curated allowlist with explicit reject for unsupported

**Description:** Maintain a strict allowlist of individually reviewed tokens. Reject all others at the contract or router level.

**Pros:**
- Strongest safety guarantee.
- Bounded audit surface.
- Clear accountability per token.

**Cons:**
- High operational burden to review and onboard tokens.
- Poor UX for long-tail tokens — significant TVL excluded.
- Centralization concern: who controls the list?
- Difficult to scale across multiple EVM networks and Solana.

### Option C: Tiered classification — verified / unverified / blocked (Recommended)

**Description:** Classify tokens into tiers with corresponding protocol and UI behavior:

| Tier | On-chain behavior | Frontend behavior |
|---|---|---|
| **Verified** | Full support, optimized paths | Default display, no warnings |
| **Unverified** | Standard-compliant paths only; extra validation checks | Warning banner, user acknowledgment required |
| **Blocked** | Rejected at router/periphery level | Not displayed; search returns blocked notice |

Verification criteria include: on-chain standard compliance, metadata validation, behavior classification (fee-on-transfer, rebasing, etc.), and optional third-party list cross-reference.

**Pros:**
- Balances safety with permissionless access.
- Users can still trade long-tail tokens with informed consent.
- Clear upgrade path: tokens move between tiers as evidence accumulates.
- Blocked tier provides emergency response for malicious tokens.

**Cons:**
- Requires building and maintaining a classification system.
- Tier boundaries need clear, documented criteria.
- "Unverified" tier still requires robust on-chain guards.

## Decision

**Recommended: Option C — Tiered classification.**

### R1 token support matrix

**EVM — Supported in R1:**
- Standard ERC-20 (verified and unverified tiers).
- Non-standard decimals (with validated decimal metadata).
- No-return-value transfers (via `SafeERC20` or equivalent).

**EVM — Blocked in R1:**
- Fee-on-transfer tokens (require per-pool accounting changes; defer to R2).
- Rebasing tokens (incompatible with constant-product and CLMM accounting).
- Tokens with active transfer restrictions that prevent pool operations.

**Solana — Supported in R1:**
- SPL Token classic.
- Token-2022 basic (no complex extensions).
- Transfer-fee extension (with fee-aware accounting).

**Solana — Blocked in R1:**
- Transfer-hook extension (arbitrary CPI risk; defer until hook audit framework exists).
- Permanent delegate tokens.
- Non-transferable tokens.
- Confidential transfer tokens.

## Security implications

- On-chain: Router and periphery must validate token program ID (Solana) and apply `SafeERC20` (EVM) unconditionally.
- Balance-before/after checks are mandatory for all swaps to detect fee-on-transfer tokens that bypass the block.
- Token metadata must never be trusted from on-chain alone; cross-reference with the registry.
- Blocked tokens must be enforced at the contract level where possible, not only in the frontend.
- Transfer-hook tokens on Solana present a reentrancy-equivalent risk and must remain blocked until a formal review framework is established.

## Economic implications

- Verified tokens get optimal routing and lower perceived friction, incentivizing projects to seek verification.
- Blocking fee-on-transfer tokens in R1 excludes some popular tokens (e.g., certain stablecoins with transfer taxes) but avoids accounting bugs that could cause LP losses.
- Token-2022 transfer-fee support on Solana increases addressable market for Solana pools.

## Operational implications

- A token classification pipeline must be built before mainnet launch.
- The blocked list must support emergency additions without a contract upgrade (e.g., via a registry contract or periphery guard).
- Monitoring must alert on tokens that exhibit unexpected transfer behavior (amount received ≠ amount sent).
- Token tier changes require review, logging, and versioning per plan.md §11.

## Alternatives rejected

- **Option A** rejected because unbounded token support is incompatible with accountable security in R1.
- **Option B** rejected because strict allowlisting is too restrictive for a permissionless DEX and creates centralization risk.

## Migration / rollback plan

- If a verified token is later found to be malicious, move it to the blocked tier via the registry. Existing pool positions remain accessible for withdrawal but new swaps are blocked.
- If R2 adds fee-on-transfer support, tokens can be reclassified from blocked to verified/unverified.
- Tier criteria changes are non-breaking and do not require contract redeployment.

## Open questions

1. Should the token registry be fully on-chain, fully off-chain, or hybrid (on-chain blocklist + off-chain verification metadata)?
2. What third-party token lists (e.g., CoinGecko, token-list repos) should seed the verified tier?
3. Should fee-on-transfer detection be automatic (balance check) or manual (registry flag)?
4. What is the SLA for token verification requests from project teams?
5. Should unverified tokens have trading volume or liquidity caps?
