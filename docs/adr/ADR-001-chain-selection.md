# ADR-001: Chain Selection

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner]
- Related requirements: REQ-002, REQ-025

## Context

OmniFi requires explicit selection of EVM networks and Solana cluster(s) for development, testing, and eventual production deployment. The plan (§4.1) prohibits fabricating chain IDs or RPC URLs. This decision affects all chain-specific work including contract deployment, indexer configuration, wallet integration, and frontend network switching.

## Decision drivers

- Development velocity — fewer chains initially means faster iteration
- Security — each network adds a unique finality model and risk surface
- User demand — target chains where DeFi liquidity and users already exist
- Cost — testnet/devnet deployment is free; mainnet deployment has real costs
- Tooling maturity — Foundry/Anchor support varies by chain

## Options considered

### Option A: Broad launch — Ethereum + Arbitrum + Base + Solana mainnet

**Pros:** Maximum user reach from day one.
**Cons:** 4 networks to test, deploy, index, and monitor simultaneously. High operational burden. Premature for an unaudited protocol.

### Option B: Ethereum + Polygon + Optimism + Solana mainnet

**Pros:** Diverse L2 ecosystem coverage.
**Cons:** Same operational burden as Option A. Polygon and Optimism have different finality models adding complexity.

### Option C: Development-first — Ethereum Sepolia + one L2 testnet + Solana devnet (Recommended)

**Pros:** Zero financial risk. Fast iteration. Validates multi-chain architecture without production exposure. Expand to mainnet only after audit and release gates pass.
**Cons:** No real user feedback until mainnet. Testnet token behavior may differ from mainnet.

## Decision

**Recommended: Option C** — Begin with test networks only. Specific mainnet targets will be decided in a follow-up ADR after audit completion and release gate D passes.

Development networks:
- EVM: Ethereum Sepolia (chain ID and RPC to be configured at setup, not hardcoded)
- EVM L2: To be selected — Arbitrum Sepolia or Base Sepolia (ADR update required)
- Solana: Devnet cluster

Production network candidates (deferred decision):
- EVM: Ethereum mainnet, Arbitrum One, Base
- Solana: Mainnet-beta

## Security implications

- Test networks eliminate risk of real fund loss during development
- Each production network added later requires its own finality policy, RPC resilience config, and indexer instance
- Different L2s have different bridge trust assumptions and reorg characteristics

## Economic implications

- No gas costs on testnets; development is free
- Production deployment costs will vary by network (Ethereum mainnet gas vs L2 gas)

## Operational implications

- Network registry (§6) must support per-environment configuration
- RPC credentials must be injected via secret manager, never committed
- Adding a production network requires: ADR update, deployment scripts, indexer config, monitoring, frontend integration

## Alternatives rejected

- Option A/B rejected: premature production exposure before audits. Plan §0.1 rule 11 prohibits deploying to public networks without authorization.

## Migration / rollback plan

Adding networks is additive — no migration needed. Removing a network requires deprecation notice and frontend/API updates.

## Open questions

- Which L2 testnet to prioritize first? (Arbitrum Sepolia vs Base Sepolia)
- Are there specific mainnet targets the project owner has in mind?

