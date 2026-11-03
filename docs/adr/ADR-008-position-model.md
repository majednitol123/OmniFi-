# ADR-008: Position Representation

- Status: Accepted
- Date: 2026-11-01
- Owners: [Pending assignment]
- Related requirements: plan.md §14.4, §22.2, §4.1

## Context

OmniFi must decide how liquidity provider (LP) positions are represented on each chain. In concentrated-liquidity AMMs, each position is unique — defined by pool, tick range, and liquidity amount — so a fungible token model (like Uniswap v2 LP tokens) is insufficient. The position model affects ownership, transferability, composability, indexing, and the security surface of the protocol.

EVM and Solana have fundamentally different account models, so the position representation must be decided independently for each chain.

### EVM considerations

- EVM supports standardized token interfaces (ERC-721, ERC-1155) with well-understood wallet and marketplace support.
- Positions need unique identification (pool + tick range + owner).
- NFT positions enable DeFi composability (collateral, lending, vaults).
- NFT callbacks (`onERC721Received`) introduce reentrancy risk.

### Solana considerations

- Solana uses an account model where data is stored in Program Derived Addresses (PDAs).
- Token minting is possible but creates one mint per position — expensive and operationally complex.
- PDAs provide natural unique addressing via seeds (pool + owner + tick range).
- Solana wallets have limited NFT position rendering compared to EVM.
- Account rent exemption costs apply to every position account.

## Decision drivers

- **Composability:** Can positions be used as collateral or transferred to vaults?
- **Wallet UX:** Do standard wallets display and manage positions correctly?
- **Gas/compute cost:** What is the cost to mint, transfer, and close positions?
- **Security surface:** Does the model introduce callback or reentrancy risks?
- **Indexing:** Can positions be efficiently enumerated and reconstructed off-chain?
- **Simplicity:** Fewer moving parts reduce audit scope and implementation risk.

## Options considered

### EVM options

#### Option A: ERC-721 NFT position (Recommended)

**Description:** Each concentrated-liquidity position is represented as a unique ERC-721 NFT. The position manager contract is the minter. Each token ID maps to position metadata (pool, tick range, liquidity, fee growth checkpoints).

**Pros:**
- Industry standard — Uniswap v3 proved this model at scale.
- Full wallet and marketplace compatibility.
- Transferable — enables composability with lending, vaults, and portfolio management.
- Standard enumeration (`tokenOfOwnerByIndex`) supports indexing.
- Clear ownership semantics (single owner, approval, operator).

**Cons:**
- `onERC721Received` callback on safe transfers introduces reentrancy risk; must be guarded.
- Gas overhead for minting (~50k gas) vs. a lightweight account model.
- Position metadata is on-chain storage; costs scale with number of positions.
- Marketplace listing of positions creates UX confusion if users don't understand LP risks.

#### Option B: ERC-1155 semi-fungible position

**Description:** Positions are represented as ERC-1155 tokens. Token IDs encode pool and tick range; amounts represent liquidity shares within that range.

**Pros:**
- Batch operations reduce gas for multi-position management.
- Semi-fungible: positions in the same range could be merged.

**Cons:**
- Concentrated-liquidity positions are not truly fungible even within the same range (different fee growth checkpoints).
- Merging positions with different entry times creates complex fee accounting.
- Less wallet support than ERC-721 for unique position display.
- No proven precedent in major CLMM protocols.

#### Option C: Non-transferable account model

**Description:** Positions are stored as contract-internal mappings keyed by `(owner, pool, tickLower, tickUpper)`. No token is minted.

**Pros:**
- Simplest implementation — no token standard overhead.
- No callback/reentrancy risk from token transfers.
- Lowest gas cost for position creation.

**Cons:**
- Positions cannot be transferred, sold, or used as collateral.
- Breaks DeFi composability expectations.
- Multiple positions in the same range by the same owner must be merged or require additional indexing.
- No standard wallet visibility.

### Solana options

#### Option A: PDA-backed position account (Recommended)

**Description:** Each position is a PDA derived from seeds: `[program_id, pool_key, owner_pubkey, tick_lower, tick_upper]`. Position data (liquidity, fee growth, rewards) is stored in the account.

**Pros:**
- Native to Solana's account model — no additional minting required.
- Deterministic addressing: given the seeds, any client can derive the position address.
- Efficient: no separate mint account, no metadata account, no associated token account.
- Position enumeration via `getProgramAccounts` with appropriate filters.
- Anchor's PDA patterns are well-documented and auditor-familiar.

**Cons:**
- Positions are non-transferable (owner is baked into seeds).
- Composability is limited: cannot send a position to a vault or use as collateral without a wrapper.
- Account rent (~0.002 SOL per position) is a minor cost.
- Multiple positions in the same range by the same owner require an additional nonce seed.

#### Option B: Tokenized position (mint-per-position)

**Description:** Each position mints a unique SPL token. The mint authority is the position manager program. Owning the token represents owning the position.

**Pros:**
- Transferable — same composability model as EVM ERC-721.
- Wallet-visible as an NFT.

**Cons:**
- Three accounts per position: mint, token account, metadata — expensive.
- ~0.01 SOL rent per position (5× more than PDA-only).
- Minting and burning add CPI complexity and compute units.
- Fewer Solana DeFi protocols support NFT-as-position collateral compared to EVM.
- Increases transaction size and compute budget.

#### Option C: Token-2022 NFT

**Description:** Use Token-2022's metadata extension to create NFT positions with on-chain metadata.

**Pros:**
- Modern Solana standard with richer metadata.
- Transferable with potential for transfer-hook-based restrictions.

**Cons:**
- Token-2022 tooling and wallet support is still maturing.
- Transfer-hook interactions add complexity and potential failure modes.
- Same cost overhead as Option B plus extension account costs.
- Audit surface expands to include Token-2022 program interactions.

## Decision

**Recommended:**
- **EVM: Option A — ERC-721 NFT position.**
- **Solana: Option A — PDA-backed position account.**

### EVM position manager specification

- `PositionManager` mints ERC-721 tokens with monotonically increasing token IDs.
- Position data: `tokenId → { pool, tickLower, tickUpper, liquidity, feeGrowthInside0LastX128, feeGrowthInside1LastX128, tokensOwed0, tokensOwed1 }`.
- Only owner/approved operator may modify liquidity, collect fees, or burn. Burn allowed only when liquidity = 0 and fees collected.
- `safeTransferFrom` must use reentrancy guards. Supports `multicall` for batched operations.

### Solana position account specification

- PDA seeds: `["position", pool_pubkey, owner_pubkey, tick_lower_bytes, tick_upper_bytes, nonce]`.
- Nonce allows multiple positions in same range by same owner.
- Account data: `{ pool, owner, tick_lower, tick_upper, liquidity, fee_growth_inside_0_last, fee_growth_inside_1_last, tokens_owed_0, tokens_owed_1, nonce }`.
- Only `owner` signer may modify or close. Closing returns rent to owner. Enumeration via `getProgramAccounts`.

## Security implications

- **EVM:** `onERC721Received` callbacks are a reentrancy vector — position manager must use reentrancy guards on all state-mutating functions. Approval/operator mechanics require authorization testing.
- **Solana:** PDA seeds must be validated every instruction to prevent seed-grinding. Owner signer verification is critical. Account closing must zero data to prevent resurrection attacks.
- Both chains: position data must be consistent with pool state; stale fee growth values cause incorrect fee claims.

## Economic implications

- EVM: ~50k gas per mint, acceptable vs. 100–200k swap gas. NFTs enable secondary market trading of positions.
- Solana: ~0.002 SOL rent per position (returned on close), ~5× cheaper than tokenized alternatives.
- PDA positions on Solana cannot be marketplace-traded — acceptable for R1 simplicity.

## Operational implications

- **Indexer:** Must track ERC-721 `Transfer`, `IncreaseLiquidity`, `DecreaseLiquidity`, and `Collect` events on EVM.
- **Indexer:** Must monitor Solana position accounts via `getProgramAccounts` and transaction log parsing.
- **Frontend:** Must render position details (range, liquidity, fees, in-range status) from on-chain data.
- **Migration:** If the position model changes in a future release, a migration path must wrap or convert existing positions.

## Alternatives rejected

- **EVM ERC-1155** rejected because concentrated-liquidity positions are not semi-fungible in practice (different fee growth histories).
- **EVM non-transferable** rejected because it eliminates DeFi composability, a key value proposition.
- **Solana tokenized positions** rejected due to cost (~5× PDA-only), complexity, and limited ecosystem support for NFT-as-collateral on Solana.
- **Solana Token-2022 NFT** rejected due to immature tooling and expanded audit surface without proportional R1 benefit.

## Migration / rollback plan

- **EVM:** If R2 requires a different position model (e.g., for v4-style singleton), a migration contract can accept old NFTs and issue new representations. Old positions remain valid until migrated.
- **Solana:** If transferability is needed in R2, a wrapper program can issue transferable tokens backed by PDA positions. Existing PDAs are unaffected.
- Position data schemas must be versioned to support future field additions.

## Open questions

1. Should EVM position NFTs include on-chain SVG metadata or use an off-chain URI?
2. Should there be a maximum number of positions per owner per pool (gas/compute bound)?
3. Should the Solana nonce be user-provided or auto-incremented?
4. Should EVM position NFTs be compatible with a specific metadata standard (e.g., ERC-4906 for metadata updates)?
5. If R2 introduces v4-style pools on EVM, should positions across pool types share a single NFT contract or have separate managers?
