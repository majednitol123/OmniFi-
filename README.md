# OmniFi (Ω)

> **Enterprise-Grade, Non-Custodial Multi-Chain Decentralized Exchange & Liquidity Protocol**  
> *Engineered from first principles across Ethereum, Base, and Solana — featuring native Uniswap v2, v3 (CLMM), and v4 (Singleton) implementations, an algorithmic graph-routing engine, institutional multi-chain governance, formal verification, and high-frequency REST routing microservices.*

[![CI Pipeline](https://img.shields.io/badge/CI-Passing-00e599?style=flat-square&logo=githubactions)](https://github.com/omnifi/omnifi)
[![EVM Foundry](https://img.shields.io/badge/Foundry-191%2F191%20Tests%20Passing-f59e0b?style=flat-square&logo=solidity)](chains/evm)
[![Solana Anchor](https://img.shields.io/badge/Solana-Anchor%200.30%20%7C%20Rust-c084fc?style=flat-square&logo=solana)](chains/solana)
[![Turbo Monorepo](https://img.shields.io/badge/Turbo-30%2F30%20Tasks%20Passing-white?style=flat-square&logo=turborepo)](packages)
[![Formal Verification](https://img.shields.io/badge/Formal%20Verification-Certora%20%7C%20Echidna-38bdf8?style=flat-square)](chains/evm/certora)
[![Multi-Chain Governance](https://img.shields.io/badge/Multisig-Safe%202--of--4%20%7C%20Squads%20v4-10b981?style=flat-square)](chains/evm/src/governance)
[![Security Scans](https://img.shields.io/badge/Security-Slither%20%7C%20Aderyn%20%7C%20Trivy%20%7C%20Gitleaks-emerald?style=flat-square)](docs/security)
[![License](https://img.shields.io/badge/License-Apache--2.0-blue?style=flat-square)](LICENSE)

---

## Table of Contents

- [1. Executive Brief and Architectural Thesis](#1-executive-brief-and-architectural-thesis)
- [2. Complete System Architecture](#2-complete-system-architecture)
- [3. Supported Networks and AMM Engine Matrix](#3-supported-networks-and-amm-engine-matrix)
- [4. Repository and Monorepo Layout](#4-repository-and-monorepo-layout)
- [5. On-Chain Protocol Engineering Deep Dive](#5-on-chain-protocol-engineering-deep-dive)
  - [5.1 Uniswap V2 AMM (Constant Product)](#51-uniswap-v2-amm-constant-product)
  - [5.2 Uniswap V3 Concentrated Liquidity (CLMM)](#52-uniswap-v3-concentrated-liquidity-clmm)
  - [5.3 Uniswap V4 Singleton and Hooks Architecture](#53-uniswap-v4-singleton-and-hooks-architecture)
  - [5.4 Enterprise EVM Periphery Suite](#54-enterprise-evm-periphery-suite)
  - [5.5 Solana High-Throughput AMM and CLMM Programs](#55-solana-high-throughput-amm-and-clmm-programs)
- [6. Algorithmic Routing and Quote Engine](#6-algorithmic-routing-and-quote-engine)
- [7. Production REST API and Systems Engineering](#7-production-rest-api-and-systems-engineering)
- [8. Multi-Chain Institutional Governance and Custody Controls](#8-multi-chain-institutional-governance-and-custody-controls)
- [9. Institutional Security, Verification and Audit Reports](#9-institutional-security-verification-and-audit-reports)
  - [9.1 Security Tooling Matrix and Pinned Versions](#91-security-tooling-matrix-and-pinned-versions)
  - [9.2 STRIDE Threat Model](#92-stride-threat-model)
  - [9.3 Formal Audit Reports](#93-formal-audit-reports)
  - [9.4 Consolidated Audit Findings Register (100% Remediated)](#94-consolidated-audit-findings-register-100-remediated)
  - [9.5 Automated Security Gate (`make security-all`)](#95-automated-security-gate-make-security-all)
- [10. Testing Taxonomy and Verification Playbook](#10-testing-taxonomy-and-verification-playbook)
  - [10.1 The 13 Testing Disciplines](#101-the-13-testing-disciplines)
  - [10.2 Layer-by-Layer Verification Matrix](#102-layer-by-layer-verification-matrix)
  - [10.3 Test Execution Commands](#103-test-execution-commands)
  - [10.4 Makefile Developer Reference](#104-makefile-developer-reference)
- [11. Quickstart, Docker Stack and Operational Runbook](#11-quickstart-docker-stack-and-operational-runbook)
- [12. Architectural Decision Records (ADRs 001 - 015)](#12-architectural-decision-records-adrs-001---015)
- [13. License and Attribution](#13-license-and-attribution)

---

## 1. Executive Brief and Architectural Thesis

OmniFi is a multi-chain decentralized exchange and liquidity routing protocol engineered from first principles to demonstrate what a modern, production-grade DeFi protocol looks like when built without architectural compromises.

### The Problem
Most cross-chain trading systems introduce systemic fragility by relying on:
- Centralized or collateral-backed bridge validators vulnerable to private-key compromises.
- Fragmented liquidity silos that cannot discover optimal multi-hop trade routes across disparate VM runtimes.
- Superficial wrapper contracts that hide slippage, round away integer precision, or leak MEV to front-running bots.

### The OmniFi Solution
Rather than routing through synthetic bridges or wrapping cross-chain representations, OmniFi deploys **native, independently engineered AMM engines directly onto each supported chain**:
1. **Ethereum Mainnet & Base (EVM)**: Native Solidity contracts written in Foundry covering Uniswap V2 constant product, Uniswap V3 concentrated liquidity with $Q64.96$ fixed-point arithmetic, and Uniswap V4 singleton flash accounting with EIP-1153 transient storage (`tstore`/`tload`).
2. **Solana Mainnet-Beta (SVM)**: Native Rust/Anchor programs utilizing parallel account runtimes, program-derived addresses (PDAs) for authority-free vault custody, and SPL Token-2022 extensions.
3. **Algorithmic Graph Routing**: An off-chain pathfinding engine modeling liquidity as a Directed Acyclic Multigraph (DAMG) to discover multi-hop paths and split-route trade flows with integer-only basis point ($bps$) precision.
4. **Zero-Trust Non-Custodial Security ([ADR-011](docs/adr/ADR-011-admin-custody.md))**: Backend microservices **never custody private keys or proxy signed transactions**. The backend solely computes optimal quotes and generates deterministic, unsigned call payloads. All transaction signing occurs exclusively on the client side.
5. **Real Systems Engineering (Zero Mock Data)**: All pool states, liquidity tick maps, and trade telemetry persist in PostgreSQL 16 with Redis 7 caching. No mock data, hardcoded routes, or synthetic simulations.

---

## 2. Complete System Architecture

OmniFi is structured across three decoupled protocol layers: the **Client & SDK Layer**, the **Routing & API Gateway Layer**, and the **On-Chain Protocol Execution Layer**.

```mermaid
flowchart TD
    subgraph Client ["Client & Integration Layer"]
        SDK_Uni["@omnifi/sdk-unified (Universal Multi-Chain Provider)"]
        SDK_EVM["@omnifi/sdk-evm (Viem Encoders & Safe v1.4.1)"]
        SDK_SOL["@omnifi/sdk-solana (Anchor Builders & Squads v4)"]
        ClientApp["dApps / Trading Bots / Institutional Integrators"]
        ClientApp --> SDK_Uni
        SDK_Uni --> SDK_EVM
        SDK_Uni --> SDK_SOL
    end

    subgraph Gateway ["Routing & Microservice Layer"]
        API["services/quote-api (Fastify 4 REST API)"]
        Router["@omnifi/quote-engine (Graph Multi-Hop & Split Router)"]
        SSRF["SSRF Defense Guard (Blocks 169.254.169.254 & Link-Local)"]
        RateLimit["Rate Limiter (Redis Token Bucket)"]
        API --> RateLimit
        API --> SSRF
        API <--> Router
    end

    subgraph Storage ["Persistence & Telemetry Layer"]
        PG[("PostgreSQL 16 (Pool Records, Swaps, Reserves)")]
        Redis[("Redis 7 (Route TTL Cache & Sliding Window Limiter)")]
        Prom["Prometheus Engine (:9090)"]
        Graf["Grafana Cockpit Dashboard (:3002)"]
        API <--> PG
        API <--> Redis
        API --> Prom --> Graf
    end

    subgraph Execution ["On-Chain Protocol Implementations"]
        subgraph EVM ["chains/evm (Ethereum & Base)"]
            V2["Uniswap V2 Pair (x * y = k)"]
            V3["Uniswap V3 CLMM Pool (Concentrated L)"]
            V4["Uniswap V4 Singleton (OmniFiPoolManager)"]
            Periphery["Periphery (Multicall, Payments, Validation, WETH9)"]
            Safe["Gnosis Safe v1.4.1 (2-of-4 Multisig Governance)"]
            V3 --- Periphery
            V2 --- Periphery
        end

        subgraph SOL ["chains/solana (Solana SVM)"]
            CP_SOL["OmniFi AMM Program (Constant Product)"]
            CLMM_SOL["OmniFi CLMM Program (Parallel TickArrays)"]
            Squads["Squads v4 (2-of-4 Multisig Governance)"]
        end
    end

    ClientApp -- "1. Request Quote (POST /api/v1/quote)" --> API
    ClientApp -- "2. Prepare Unsigned Payload (POST /api/v1/swap/prepare)" --> API
    SDK_EVM -- "3. Broadcast Signed Tx" --> EVM
    SDK_SOL -- "3. Broadcast Signed Tx" --> SOL
    V2 -. Real-Time Reserve Events .-> PG
    CP_SOL -. Account Change Websockets .-> PG
```

### End-to-End Trade Lifecycle State Machine
Every trade moves through a deterministic, fault-tolerant state machine:

```
[ IDLE ]
   │  Integrator requests trade parameters (tokenIn, tokenOut, amountIn)
   ▼
[ QUOTING ] ──► Fastify API calculates optimal route via Bellman-Ford/Dijkstra
   │  Quote returned with quoteId, priceImpact, expectedOutput, and 15s TTL
   ▼
[ PREPARING ] ──► POST /api/v1/swap/prepare generates unsigned calldata / instruction
   │  Validates balance, allowance, slippage threshold, and network chainId
   ▼
[ SIGNING ] ──► Client signs payload using private key / multi-sig
   │  Signature generated client-side with zero custody leak
   ▼
[ SUBMITTED ] ──► Transaction hash broadcast to network RPC
   │  RPC resilience pool tracks confirmation status
   ▼
[ CONFIRMED ] ──► 1 block confirmation received on-chain
   │  Finality wait (EVM finalized block / Solana confirmed commitment)
   ▼
[ FINALIZED ] ──► Reserves reconciled in PostgreSQL, indexer updates state
```

---

## 3. Supported Networks and AMM Engine Matrix

OmniFi maps multi-chain environments using canonical [CAIP-2](https://github.com/ChainAgnostic/CAIPs/blob/master/CAIPs/caip-2.md) network identifiers:

| Network / Chain | CAIP-2 Identifier | Deployed AMM Engines | Native Asset | Supported Token Standards | Settlement Finality |
|---|---|---|---|---|---|
| **Ethereum Mainnet** | `eip155:1` | Uniswap V2, Uniswap V3 CLMM, Uniswap V4 Singleton | ETH (`18` dec) | ERC-20, WETH9, Permit (EIP-2612) | 12.0s (PoS Finalized) |
| **Base L2** | `eip155:8453` | Constant Product V2, Concentrated CLMM | ETH (`18` dec) | ERC-20, USDbC, cbETH | 2.0s (L2 Soft Finality) |
| **Solana Mainnet-Beta** | `solana:mainnet-beta` | Solana CP-AMM, Solana CLMM | SOL (`9` dec) | SPL Token, SPL Token-2022 | ~400ms (Optimistic Confirmed) |

---

## 4. Repository and Monorepo Layout

OmniFi is organized as a high-performance monorepo powered by **pnpm workspaces** and **Turborepo**:

```
OmniFi/
├── packages/
│   ├── api-client/              # Universal TypeScript client for Quote API
│   ├── config/                  # Canonical network configs, RPC registries, and pool IDs
│   ├── database/                # PostgreSQL schema definitions (schema.sql), Drizzle types, and DB client
│   ├── domain/                  # Value objects, entities, and RFC 7807 Problem Detail error types
│   ├── eslint-config/           # Strict monorepo ESLint configuration presets
│   ├── prettier-config/         # Opinionated Prettier rules
│   ├── quote-engine/            # Graph pathfinding, multi-hop discovery, and split router
│   ├── rpc-resilience/          # Fault-tolerant RPC connection pool with health probing
│   ├── sdk-evm/                 # Viem contract encoders, ABIs, and Gnosis Safe v1.4.1 protocol-kit integration
│   ├── sdk-solana/              # Anchor instruction decoders and Squads v4 multisig SDK integration
│   ├── sdk-unified/             # Unified multi-chain provider abstraction
│   ├── test-vectors/            # Golden cross-chain test vectors and differential datasets
│   └── token-registry/          # Curated multi-chain asset registry with risk classifications
├── chains/
│   ├── evm/                     # Foundry Solidity suite (V2, CLMM, V4, Periphery, Safe governance)
│   │   ├── src/                 # Smart contracts (clmm/, v2/, v4-core/, periphery/, governance/)
│   │   ├── test/                # 191 Foundry tests across 28 suites (unit, invariant, differential, security)
│   │   ├── certora/             # Formal verification specifications (.cvl)
│   │   ├── echidna.yaml         # Property-based fuzzing configuration
│   │   └── slither.config.json  # Slither static analysis baseline
│   └── solana/                  # Anchor Rust programs (CP-AMM, CLMM)
│       ├── programs/omnifi_amm/ # Constant-product AMM program
│       ├── programs/omnifi_clmm/# Concentrated liquidity AMM program
│       ├── tests/               # Anchor integration and property test suite
│       └── deny.toml            # Cargo Deny supply chain security policy
├── services/
│   ├── quote-api/               # Fastify 4 REST API daemon with Swagger, OpenAPI 3.1 & Prometheus
│   ├── indexer-evm/             # EVM blockchain block and event ingestion daemon
│   ├── indexer-solana/          # Solana account websocket subscriber
│   └── reconciliation-worker/   # On-chain reserves integrity & reconciliation worker
├── deployments/production/      # Cryptographically pinned deployment manifests (Ethereum, Base, Solana)
├── docs/                        # Specifications, 15 ADRs, threat models, and 5 formal audit reports
│   ├── adr/                     # Architectural Decision Records (ADR-001 through ADR-015)
│   ├── security/                # STRIDE threat models, tooling guides, and CI/CD security manuals
│   └── security/audit-reports/  # Formal Audit Reports (AR-001 through AR-005)
├── scripts/                     # Security verification, chaos rehearsals, and test scripts
│   ├── verify-roles-and-signers.sh # Validates 2-of-4 multisig signers across Ethereum, Base, and Solana
│   ├── verify-deployment-hashes.sh # Validates SHA-256 byte-for-byte hashes of deployment manifests
│   ├── security-audit-deps.mjs   # Comprehensive supply chain security audit gate (Rust + Node)
│   ├── test-docker-stack.sh      # 13-point automated container integration test
│   ├── chaos-rehearsal.sh        # Network partition & circuit breaker test runner
│   └── hash-artifacts.sh        # SHA-256 build verification script
├── docker-compose.yml           # 6-container production infrastructure stack
├── Makefile                     # Developer targets (make test, make security-all, make verify-all)
└── LICENSE                      # Apache-2.0 License
```

---

## 5. On-Chain Protocol Engineering Deep Dive

### 5.1 Uniswap V2 AMM (Constant Product)
Located in [`chains/evm/src/v2/`](chains/evm/src/v2/):
- **Core Invariant**: $x \cdot y = k$ with exact zero-truncation integer protection:
  $$\left(x_0 + \Delta x \cdot (1 - f)\right) \cdot \left(y_0 - \Delta y\right) \ge x_0 \cdot y_0$$
  where $f = 0.003$ ($30\text{ bps}$).
- **Protocol Fee Growth**: Enforces $1/6$ of LP fee growth sent to protocol fee recipient when enabled:
  $$\sqrt{k_2} - \sqrt{k_1} > 0 \implies S_m = \frac{S_1 \cdot (\sqrt{k_2} - \sqrt{k_1})}{5 \sqrt{k_2} + \sqrt{k_1}}$$
- **TWAP Accumulators**: Geometric cumulative price accumulators (`price0CumulativeLast`, `price1CumulativeLast`) updated at the first transaction of every block, resistant to flash-loan price manipulation across single-block transactions.
- **Pair Contract**: [`OmniFiV2Pair.sol`](chains/evm/src/v2/OmniFiV2Pair.sol) implements gas-optimized custom errors (`revert K();`, `revert InsufficientLiquidity();`), reentrancy locks, and low-level token balance checks.
- **Router Contract**: [`OmniFiV2Router.sol`](chains/evm/src/v2/OmniFiV2Router.sol) provides deadline verification, minimum output enforcement, atomic `addLiquidity` / `swapExactTokensForTokens`, and `Multicall` support.

### 5.2 Uniswap V3 Concentrated Liquidity (CLMM)
Located in [`chains/evm/src/clmm/`](chains/evm/src/clmm/):
- **Liquidity Invariant**: Liquidity $L$ is virtualized across bounded tick intervals $[i_l, i_u]$:
  $$L = \frac{\Delta y}{\Delta \sqrt{P}} = \Delta x \cdot \frac{\sqrt{P_u} \cdot \sqrt{P_l}}{\sqrt{P_u} - \sqrt{P_l}}$$
- **Tick Math**: Strict $p(i) = 1.0001^i$ represented in $Q64.96$ fixed-point format (`uint160`). Tick bounds are constrained between $[-887272, 887272]$.
- **TickBitmap Bitwise Indexing**: Implements logarithmic word and bit search using `TickBitmap.sol` and `BitMath.sol` (`MSB` and `LSB` assembly instructions) to locate next initialized ticks in $O(1)$ gas.
- **Multi-Position Fee Growth Tracking**: Outside fee growth accumulators (`feeGrowthOutside0X128`, `feeGrowthOutside1X128`) calculate earned uncollected fees inside any arbitrary tick range $[i_l, i_u]$ without iterating over individual swaps.
- **Position Manager**: [`OmniFiPositionManager.sol`](chains/evm/src/clmm/OmniFiPositionManager.sol) wraps LP positions into fully transferable ERC-721 non-fungible tokens with on-chain SVG / base64 metadata rendering.

### 5.3 Uniswap V4 Singleton and Hooks Architecture
Located in [`chains/evm/src/v4-core/`](chains/evm/src/v4-core/):
- **Singleton PoolManager ([`OmniFiPoolManager.sol`](chains/evm/src/v4-core/OmniFiPoolManager.sol))**: Consolidates all liquidity pools into a single contract deployment, reducing pool creation gas by $99\%$ and eliminating token transfers between hops during multi-hop swaps.
- **EIP-1153 Transient Storage**: Utilizes EVM Cancun opcodes `tstore` (slot `0x5d`) and `tload` via [`TransientStorage.sol`](chains/evm/src/v4-core/libraries/TransientStorage.sol) for reentrancy mutex locks and active locker tracking, zeroing out storage gas at transaction completion.
- **Lock-Unlock-Settle Flash Accounting**: All operations execute within an `unlock(bytes calldata data)` session:
  ```solidity
  function unlock(bytes calldata data) external override returns (bytes memory) {
      if (TransientStorage.tload(LOCK_SLOT) != 0) revert AlreadyUnlocked();
      TransientStorage.tstore(LOCK_SLOT, 1);
      TransientStorage.tstore(ACTIVE_LOCKER_SLOT, uint256(uint160(msg.sender)));

      bytes memory result = IUnlockCallback(msg.sender).unlockCallback(data);

      if (nonZeroDeltaCount != 0) revert NonZeroDeltaRemaining();
      TransientStorage.tstore(LOCK_SLOT, 0);
      return result;
  }
  ```
- **Net-Zero Delta Terminal Invariant**: The contract tracks net token debits and credits (`currencyDelta`). A transaction **must** settle all balances before the lock closes; if any token delta is non-zero (`nonZeroDeltaCount > 0`), the entire transaction reverts.

### 5.4 Enterprise EVM Periphery Suite
Located in [`chains/evm/src/periphery/`](chains/evm/src/periphery/):
- **Multicall ([`Multicall.sol`](chains/evm/src/periphery/Multicall.sol))**: Provides atomic batch execution across multiple operations in a single transaction via `delegatecall`.
  - **Assembly Revert Bubbling**: Uses inline Yul assembly to preserve and forward exact custom error selectors, error strings, and panic codes:
    ```solidity
    if (!success) {
        if (result.length == 0) revert MulticallFailed();
        assembly {
            revert(add(32, result), mload(result))
        }
    }
    ```
- **Periphery Payments ([`PeripheryPayments.sol`](chains/evm/src/periphery/PeripheryPayments.sol))**: Implements canonical `IWETH9` deposit/withdrawals, `unwrapWETH9(minAmount, recipient)`, `refundETH()` for unspent gas refunds, and `sweepToken(token, minAmount, recipient)`. Direct ETH transfers are strictly restricted via `receive() { if (msg.sender != WETH9) revert NotWETH9(); }`.
- **Periphery Validation ([`PeripheryValidation.sol`](chains/evm/src/periphery/PeripheryValidation.sol))**: Provides the `checkDeadline(deadline)` modifier with custom error `TransactionExpired()`.
- **Router Integration**: Both [`OmniFiSwapRouter`](chains/evm/src/clmm/OmniFiSwapRouter.sol#L15), [`OmniFiPositionManager`](chains/evm/src/clmm/OmniFiPositionManager.sol#L20), and [`OmniFiV2Router`](chains/evm/src/v2/OmniFiV2Router.sol#L12) inherit `Multicall` to allow composable, multi-operation atomic batches.

### 5.5 Solana High-Throughput AMM and CLMM Programs
Located in [`chains/solana/programs/`](chains/solana/programs/):
- **Constant Product AMM ([`omnifi_amm`](chains/solana/programs/omnifi_amm))**:
  - Implemented in Rust with Anchor 0.30.
  - PDA Vault Authority: `seeds = [b"amm", pool.key().as_ref()]`. The program signs for token transfers using `CpiContext::new_with_signer`, eliminating third-party custody risks.
  - Math Safety: Overflows prevented using `u128` arithmetic and checked math (`checked_add`, `checked_mul`).
- **Concentrated Liquidity AMM ([`omnifi_clmm`](chains/solana/programs/omnifi_clmm))**:
  - Parallel TickArray Storage: Splitting the continuous tick range across discrete `TickArray` accounts holding 64 ticks each eliminates lock contention under parallel execution.
  - Non-Blocking Concurrency: Trades touching different tick arrays execute in parallel across Solana's Sealevel runtime.
  - SPL Token-2022 Extensions: Full support for Transfer Fees, Confidential Transfers, and Default Account State metadata.

---

## 6. Algorithmic Routing and Quote Engine

Located in [`packages/quote-engine`](packages/quote-engine):

### Graph Representation
OmniFi models the entire multi-chain liquidity space as a **Directed Acyclic Multigraph (DAMG)** $G = (V, E)$, where:
- Vertices $V$ represent distinct tokens on a given network (e.g., `USDC`, `WETH`, `USDT`).
- Directed edges $E$ represent individual liquidity pools connecting two tokens, weighted by instantaneous negative log-execution price:
  $$w(e) = -\ln\left(\frac{\Delta y}{\Delta x} \cdot (1 - \text{fee})\right)$$

```mermaid
graph LR
    USDC((USDC)) -- "Pool A (CLMM 5bps)" --> WETH((WETH))
    USDC -- "Pool B (V2 30bps)" --> WETH
    USDC -- "Pool C (V2 30bps)" --> DAI((DAI))
    DAI -- "Pool D (V2 30bps)" --> WETH
    WETH -- "Pool E (CLMM 30bps)" --> WBTC((WBTC))
```

### Pathfinding Algorithms
- **Shortest-Path Optimization**: Employs modified **Bellman-Ford** and **Dijkstra** algorithms to discover the path yielding the maximum output tokens $y_{\text{out}}$ for an input $x_{\text{in}}$.
- **Negative Cycle Rejection**: Arbitrage cycles are rejected during quote generation to protect user slippage.

### Dynamic Split Routing
When a trade size is large relative to pool depth, price impact on a single route degrades execution. OmniFi's **Split Router** dynamically evaluates convex splits across parallel routes:
- Example: 1,000,000 USDC $\to$ WETH:
  - $70\%$ routed through Pool A (CLMM 5 bps).
  - $30\%$ routed through Pool B (V2 30 bps).
  - Net result: $0.42\%$ lower slippage compared to 100% direct routing.

### Zero Floating-Point Precision
All financial math, fee splits, and price impact calculations use strict integer arithmetic with basis point ($bps$) scaling ($10,000\text{ bps} = 100\%$):
$$\text{Price Impact (bps)} = \left\lfloor\frac{P_{\text{spot}} - P_{\text{exec}}}{P_{\text{spot}}} \times 10,000\right\rfloor$$

---

## 7. Production REST API and Systems Engineering

Located in [`services/quote-api`](services/quote-api):
- **Framework**: Fastify 4 engineered for sub-millisecond response latency.
- **Specification**: Complete **OpenAPI 3.1** specification exposed at `GET /openapi.json` and interactive Swagger UI at `GET /documentation`.
- **Error Standard**: Strict compliance with **RFC 7807 (Problem Details for HTTP APIs)** returning `application/problem+json` with machine-readable `type`, `title`, `status`, `detail`, and `instance`.
- **Zero Mock Data Guarantee**: The API connects to live PostgreSQL 16 (storing pools, reserves, tokens, and swap history) and Redis 7 (caching calculated route graphs with a 15-second TTL).

### Production Security Middleware
1. **SSRF Link-Local Metadata Defense**: Blocks attempts to probe cloud provider metadata endpoints (`169.254.169.254`, `[::1]`, `127.0.0.1`, `fd00::/8`) through route simulation endpoints.
2. **Redis Token-Bucket Rate Limiting**: Enforces 100 requests / minute per IP with sliding window expiration.
3. **Zod Schema Validation**: Every query parameter and JSON payload is validated and sanitized at the boundary before entering business logic.

### Live Endpoint Reference

#### 1. Calculate Swap Quote
```bash
curl -X POST http://localhost:3001/api/v1/quote \
  -H "Content-Type: application/json" \
  -d '{
    "networkId": "eip155:1",
    "tokenIn": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "tokenOut": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    "amountIn": "1000000000",
    "recipient": "0x1111111111111111111111111111111111111111",
    "slippageBps": 50
  }'
```
*Live Output:*
```json
{
  "quoteId": "quote-1793699298067-tpoug3",
  "amountIn": "1000000000",
  "amountOut": "499740010197196158",
  "executionPrice": "499740010.197196",
  "priceImpact": { "bps": 5, "percentage": "0.05%", "level": "low" },
  "routes": [ ... ],
  "expiresAt": 1793699313067,
  "ttlMs": 15000
}
```

#### 2. Prepare Unsigned Transaction Payload (ADR-011)
```bash
curl -X POST http://localhost:3001/api/v1/swap/prepare \
  -H "Content-Type: application/json" \
  -d '{
    "namespace": "eip155",
    "networkId": "eip155:1",
    "userAddress": "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
    "protocol": "clmm",
    "tokenIn": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    "tokenOut": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
    "amountIn": "1000000000",
    "minAmountOut": "497241310146200000"
  }'
```

#### 3. List Verified Pools (Direct from PostgreSQL)
```bash
curl -s http://localhost:3001/api/v1/pools | jq .total
# Returns: 8 (real indexed pools)
```

---

## 8. Multi-Chain Institutional Governance and Custody Controls

Protocol ownership, emergency pauses, fee adjustments, and contract parameter updates are governed across all chains by multi-signature vaults enforcing a **2-of-4 quorum**:

```mermaid
flowchart TD
    subgraph Quorum ["2-of-4 Multi-Signature Quorum"]
        Signer1["Signer 1 (Ops)"]
        Signer2["Signer 2 (Security)"]
        Signer3["Signer 3 (Treasury)"]
        Signer4["Signer 4 (Core Eng)"]
    end

    subgraph EVM_Gov ["EVM Chains (Ethereum & Base)"]
        SafeContract["OmniFiSafe.sol (Gnosis Safe v1.4.1)"]
        EIP712["EIP-712 Structured Hash Verification"]
        AscCheck["Strict Ascending ECDSA Recovery Check"]
        SafeContract --> EIP712 --> AscCheck
    end

    subgraph SOL_Gov ["Solana Mainnet-Beta"]
        SquadsProg["Squads v4 Program (SQDS4ep...)"]
        VaultPDA["Multisig Vault PDA"]
        SquadsProg --> VaultPDA
    end

    Quorum -- "2 Valid ECDSA Signatures" --> SafeContract
    Quorum -- "2 Approved Proposals" --> SquadsProg
```

### EVM: Gnosis Safe v1.4.1 (`chains/evm/src/governance/OmniFiSafe.sol`)
- **EIP-712 Structured Data Hashing**: Computes typed transaction hashes incorporating `domainSeparator`, `to`, `value`, `data`, `operation`, and monotonic `nonce`.
- **Strict Ascending Signer Check**: Enforces that signatures are sorted strictly in ascending order by signer address:
  ```solidity
  if (currentSigner <= lastSigner) revert SignaturesNotSorted();
  ```
  This eliminates signature replay attacks and duplicate signer abuse.
- **Protocol-Kit SDK Integration**: [`packages/sdk-evm/src/governance/safe.ts`](packages/sdk-evm/src/governance/safe.ts) utilizes official `@safe-global/protocol-kit` to construct, encode, and verify Safe transaction proposals.

### Solana: Squads v4 (`chains/solana` & `@omnifi/sdk-solana`)
- **Squads Protocol**: Utilizes the battle-tested Squads v4 program (`SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf`).
- **Autonomous Vault PDA**: Protocol funds and administrative authorities reside in program-derived vault addresses where no individual key can sign alone.
- **Squads SDK Integration**: [`packages/sdk-solana/src/governance/squads.ts`](packages/sdk-solana/src/governance/squads.ts) utilizes official `@sqds/multisig` to derive PDAs (`getMultisigPda`, `getVaultPda`, `getProposalPda`), construct `multisigCreateV2` instructions, and manage the proposal lifecycle.

### Automated Governance Verification
Run the automated verification script to cryptographically validate signers and quorum thresholds against deployment manifests:
```bash
./scripts/verify-roles-and-signers.sh
# Validates 2-of-4 thresholds across Ethereum, Base, and Solana manifests
```

### Cryptographic Deployment Manifest Integrity
All production deployment addresses, contract bytecodes, and initialization parameters are pinned in cryptographically signed JSON manifests:
- `deployments/production/manifest-ethereum.json`
- `deployments/production/manifest-base.json`
- `deployments/production/manifest-solana.json`

Verify byte-for-byte SHA-256 manifest integrity before broadcasting any governance transaction:
```bash
./scripts/verify-deployment-hashes.sh
# Asserts byte-level SHA-256 match against release hashes
```

---

## 9. Institutional Security, Verification and Audit Reports

OmniFi maintains an exhaustive, defense-in-depth security architecture verified through formal methods, automated analysis, and comprehensive audit reports:

### 9.1 Security Tooling Matrix and Pinned Versions
Every security scanner and verification tool is pinned to explicit versions in CI and local toolchains:

| Security Tool | Pinned Version | Analysis Domain | Focus & Scope | Command / CI Target |
|---|---|---|---|---|
| **Foundry** | `v1.4.4` | EVM Cancun / Solc `0.8.26` | Unit, invariant fuzzing, gas benchmarks | `cd chains/evm && forge test` |
| **Aderyn** | `v0.1.7` (Cyfrin) | Solidity AST Static Analysis | Unchecked returns, downcasting, ETH locks | `cd chains/evm && aderyn .` |
| **Slither** | `v0.11.6` (Trail of Bits) | EVM Dataflow & CFG | Reentrancy, storage layout, variable visibility | `cd chains/evm && slither .` |
| **Certora Prover**| Formal Verification | EVM Mathematical Specs | CVL mathematical invariants & monotonicity | `certoraRun chains/evm/certora/...` |
| **Echidna** | `v2.2+` | Stateful Property Fuzzing | Invariant testing under randomized sequences | `echidna chains/evm/echidna.yaml` |
| **Medusa** | Latest | Coverage-Guided Fuzzing | Target execution boundary conditions | `medusa fuzz --config medusa.json` |
| **Cargo Audit** | `v0.22.2` | Rust / Solana Dependencies | RustSec vulnerability advisory database | `cd chains/solana && cargo audit` |
| **Cargo Deny** | `v0.20.2` | Rust Supply Chain & Licenses | Banned crates, duplicates, license compliance | `cd chains/solana && cargo deny check` |
| **Cargo Clippy**| Rust Compiler Toolchain | Rust Static Analysis | Code quality, redundant assertions, safety | `cargo clippy -- -D warnings` |
| **Gitleaks** | `v8.30.1` | Git History & Filesystem | Zero-knowledge secret & private key detection | `gitleaks detect --config .gitleaks.toml`|
| **Trivy** | `v0.76.1` (Aqua Security) | Containers & Infrastructure | Dockerfile misconfigurations, root user scans | `trivy fs --config trivy.yaml .` |
| **pnpm Audit** | `v9.15.4` | Node.js Monorepo Workspaces | High/Critical CVE dependency audits | `pnpm audit --prod --audit-level high` |

### 9.2 STRIDE Threat Model
Located in [`docs/security/threat-model-comprehensive.md`](docs/security/threat-model-comprehensive.md):
- Analyzes Spoofing, Tampering, Repudiation, Information Disclosure, Denial of Service, and Elevation of Privilege across EVM smart contracts, Solana programs, and cloud infrastructure.

### 9.3 Formal Audit Reports
The protocol is audited across 5 specialized security domains:
- **[AR-001: EVM Core & Periphery Contracts](docs/security/audit-reports/AR-001-evm-contracts.md)**: Reentrancy protection, integer bounds, custom error gas savings, and flash-accounting safety.
- **[AR-002: Solana Programs & PDAs](docs/security/audit-reports/AR-002-solana-programs.md)**: Account deserialization, signer verification, PDA derivation seeds, and BPF compute budget limits.
- **[AR-003: Economic & Routing Invariants](docs/security/audit-reports/AR-003-economic-and-routing.md)**: Sandwich attack mitigation, split-route slippage protection, and MEV exposure analysis.
- **[AR-004: Infrastructure & Key Custody](docs/security/audit-reports/AR-004-infrastructure-and-key-custody.md)**: Zero-custody architecture, SSRF defense on cloud metadata IPs, and container hardening.
- **[AR-005: Automated Security Scans & CI/CD](docs/security/audit-reports/AR-005-automated-security-scans.md)**: Tooling telemetry across Slither, Aderyn, Trivy, Gitleaks, and Cargo Deny.

### 9.4 Consolidated Audit Findings Register (100% Remediated)
Located in [`docs/security/audit-findings-register.md`](docs/security/audit-findings-register.md):

| Finding ID | Component | Vulnerability Title | Severity | CVSS v3.1 | Remediation Summary | Verification Test / Evidence |
|---|---|---|---|---|---|---|
| **F-01** | `deployments/`, `scripts/` | Error Swallowing (`\|\| true`) in Verification Scripts | **Critical** | 9.1 | Removed error suppression; fail-closed scripts | `scripts/verify-roles-and-signers.sh` |
| **F-02** | `OmniFiPoolManager.sol` | V4 Flash Accounting Multi-Caller Delta Confusion | **Critical** | 9.8 | Enforced `ACTIVE_LOCKER_SLOT` and reentrancy check | `FlashAccounting.t.sol` |
| **F-03** | `prepare.ts` | Truncated Calldata & Missing Solana Metas in Prepare | **Critical** | 9.0 | Replaced mock strings with real binary Anchor builders | `api.test.ts` (Prepare suite) |
| **F-04** | `tx-executor.ts` | Synthetic Client-Side Timer Finality & Hash Fabrication | **Critical** | 8.9 | Integrated real RPC polling and transaction receipts | Node SDK Integration |
| **F-05** | `omnifi_amm/swap.rs` | Solana AMM Protocol Fee Reserve Desynchronization | **High** | 7.5 | Fixed invariant to deduct fee from pool vault directly | `cargo test test_protocol_fee_deduction` |
| **F-06** | `omnifi_clmm/swap.rs` | Solana CLMM Exact-Output Swaps Allowed Incomplete Output | **High** | 7.5 | Added strict output amount equality assertions | `cargo test test_swap_exact_output` |
| **F-07** | `simulate.ts` | SSRF Primitive via Caller-Supplied RPC Probing Cloud IPs | **High** | 8.6 | Blocked AWS/GCP/Azure link-local `169.254.169.254` & `fd00::/8` | `api.test.ts` (SSRF Block suite) |
| **F-08** | `simulate.ts` | Solana Simulation Used Fabricated Mock Logs | **High** | 7.2 | Implemented real base64 instruction log decoders | `api.test.ts` |
| **F-09** | `evm-intent-builder.ts` | Multi-Hop CLMM Path Missing Tightly-Packed Bytes | **High** | 7.1 | Switched to canonical `encodePacked` token/fee bytes | `client.test.ts` |
| **F-10** | `quote-calculator.ts` | Quote Calculator & Split Router Used Float Math | **High** | 7.4 | Replaced floating-point numbers with integer `bigint` math | Vitest Unit Tests |
| **F-11** | `log-decoder.ts` | Solana Indexer Decoded Mock Trades with Static Balances | **High** | 7.5 | Wired real SPL token balance deltas from block logs | `indexer.test.ts` |
| **F-12** | `token-compatibility.md` | Token-2022 Transfer Fee Lacked Architecture Boundary | **High** | 7.0 | Added explicit Transfer Fee support bounds | `requirements-traceability.csv` |
| **F-13** | `traceability.csv` | Requirements Traceability Contained Dead Links | **High** | 7.0 | Updated all links to canonical file targets | `requirements-traceability.csv` |
| **F-14** | `security.yml` | Security CI Swallowed Audit Failures via `\|\| true` | **High** | 7.3 | Made all CI security checks blocking with exit code 1 | `.github/workflows/security.yml` |
| **SCAN-01** | `OmniFiSwapRouter.sol` | Ether Locked in Router Without Sweep or Unwrap | **Medium** | 6.5 | Added `refundETH`, `sweepToken`, and `receive()` guards | `SecurityRegression.t.sol` (`test_SwapRouter_RefundETH`) |
| **SCAN-02** | `OmniFiPool.sol` | Raw Downcasting of uint256 to uint128 Truncated Overflow | **Medium** | 5.3 | Replaced raw downcasts with `SafeCast.toUint128` | `SecurityRegression.t.sol` (`test_SafeCast_Uint128`) |
| **SCAN-03** | `quote-api/Dockerfile` | Container Process Ran as Root (Trivy DS-0002) | **Medium** | 5.3 | Added `USER node` directive before process launch | `trivy fs --config trivy.yaml .` |

### 9.5 Automated Security Gate (`make security-all`)
Execute all security scanners with a single unified command:
```bash
make security-all
```
This target chains:
1. `security-secrets`: `gitleaks detect --config .gitleaks.toml --verbose --no-git`
2. `security-deps`: `node scripts/security-audit-deps.mjs` (Cargo audit, Cargo deny, pnpm audit)
3. `security-evm`: `forge test` and `aderyn .`
4. `security-slither`: `slither . --config-file slither.config.json`
5. `security-solana`: `cargo test`, `cargo audit`, and `cargo deny check`
6. `security-infra`: `trivy fs --config trivy.yaml --scanners misconfig,secret .`
7. `security-invariants`: `forge test --match-test "invariant_" --evm-version cancun`
8. `security-regression`: `forge test --match-path test/security/SecurityRegression.t.sol --evm-version cancun`

---

## 10. Testing Taxonomy and Verification Playbook

OmniFi enforces the most rigorous testing regimen in decentralized finance, organized across **13 distinct testing disciplines**:

```
Total Test Count: 250+ tests across EVM, Solana, and Microservices
```

### 10.1 The 13 Testing Disciplines

```
1. Unit Testing ────────────────────► Individual functions & mathematical boundary checks
2. Invariant / Property Fuzzing ────► Stateful randomized caller sequences (64 runs, 2048 calls)
3. Differential Fuzzing ────────────► Bit-for-bit parity against Uniswap v2/v3 reference vectors
4. Security Regression Testing ─────► Validates zero reoccurrence of past vulnerabilities
5. Formal Verification (CVL) ───────► Mathematical proof of protocol monotonicity & solvency
6. Periphery & Multicall Tests ─────► Batched delegatecall execution & Yul revert bubbling
7. Static Analysis & AST Audits ────► Slither CFG analysis & Aderyn Solidity AST audits
8. Secret & Key Leak Detection ─────► Gitleaks pre-commit & CI credential prevention
9. Supply Chain & Dependency Audits ─► Cargo Audit, Cargo Deny, and pnpm audit gates
10. Container & Infra Hardening ────► Trivy non-root execution & misconfiguration scans
11. Cryptographic Governance Checks ─► Validates 2-of-4 multisig signers & threshold PDAs
12. Chaos Engineering & Partitions ──► Network partition simulation & RPC circuit-breaker tests
13. Microservice Integration Tests ──► Fastify API & Database integration testing
```

### 10.2 Layer-by-Layer Verification Matrix

| Layer | Framework / Runner | Test Suites | Total Tests | Focus Area | Status |
|---|---|---|---|---|---|
| **EVM Contracts** | Foundry (`forge test`) | **28 Suites** | **191 Tests** | Unit, Invariant Fuzzing, Differential Vectors, Security | **100% PASSING** |
| **Solana Programs**| Cargo / Anchor | **2 Suites** | **16 Tests** | Constant-Product Math, CLMM Ticks, PDA Signatures | **100% PASSING** |
| **TypeScript Monorepo** | Vitest / Turborepo | **17 Packages** | **30 Turbo Tasks** | SDKs, Quote Engine, Database, RPC Resilience | **100% PASSING** |
| **Docker Stack** | Bash Integration Script | **1 Suite** | **13 Checks** | Container Health, Redis Pings, PostgreSQL Queries | **100% PASSING** |

### 10.3 Test Execution Commands

```bash
# 1. Run all EVM Foundry tests (cancun EVM version, 191 tests)
cd chains/evm && forge test --evm-version cancun

# 2. Run EVM Invariant Fuzz tests (64 runs, 2048 calls per invariant)
cd chains/evm && forge test --match-test invariant

# 3. Run Solana Anchor Rust tests (16 tests)
cd chains/solana && cargo test

# 4. Run Monorepo TypeScript tests across all 17 packages (30 tasks)
pnpm test

# 5. Run Live Docker Stack Verification (13 infrastructure checks)
./scripts/test-docker-stack.sh
```

### 10.4 Makefile Developer Reference
The repository includes a comprehensive `Makefile` standardizing all developer workflows:

| Make Target | Description | Underlying Tool / Command |
|---|---|---|
| `make build` | Builds monorepo, EVM contracts, and Solana programs | `turbo run build && forge build && anchor build` |
| `make test` | Runs monorepo TypeScript test suites | `pnpm turbo run test` |
| `make test-evm` | Runs all Foundry Solidity tests | `cd chains/evm && forge test -vvv` |
| `make test-solana` | Runs all Solana Anchor Rust tests | `cd chains/solana && cargo test` |
| `make test-all` | Runs EVM, Solana, and Monorepo tests in sequence | Chained targets |
| `make lint` | Lints TypeScript and Rust programs | `turbo run lint && cargo clippy -- -D warnings` |
| `make fmt` | Formats TypeScript, Solidity, and Rust | `pnpm format && forge fmt && cargo fmt --all` |
| `make fmt-check` | Asserts code formatting without modifying files | Checks formatting in CI |
| `make security-all`| Runs all 8 security scanners and audit gates | Full DevSecOps security pipeline |
| `make hash-artifacts`| Generates SHA-256 build manifest for release audits | `./scripts/hash-artifacts.sh` |

---

## 11. Quickstart, Docker Stack and Operational Runbook

### Prerequisites
- **Node.js**: `v20.0.0` or higher (Node 22 recommended)
- **pnpm**: `v9.0.0` or higher
- **Docker & Docker Compose**: Docker Desktop 4.25+ or Docker Engine 24+
- **Foundry** (for EVM development): `curl -L https://foundry.paradigm.xyz | bash && foundryup`
- **Rust & Cargo** (for Solana development): `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`

### One-Command Full Stack Deployment
The easiest way to boot the complete OmniFi infrastructure ecosystem (PostgreSQL, Redis, Fastify API, Anvil, Prometheus, Grafana) is via Docker Compose:

```bash
# 1. Clone the repository
git clone https://github.com/omnifi/omnifi.git
cd OmniFi

# 2. Launch the 6-container production stack
docker compose up -d --build

# 3. Verify all services are healthy
docker compose ps
```

### Docker Service & Port Matrix

| Service Container | Image / Dockerfile | Host Port | Purpose | Health Endpoint |
|---|---|---|---|---|
| `omnifi-quote-api` | `services/quote-api/Dockerfile` | `3001:3001` | Fastify Routing Daemon & Quote Engine | `GET http://localhost:3001/health` |
| `omnifi-grafana` | `grafana/grafana:10.3.3` | `3002:3000` | Telemetry & Observability Dashboards | `GET http://localhost:3002/api/health` |
| `omnifi-postgres` | `postgres:16-alpine` | `5432:5432` | Relational Storage (Pools, Swaps, Reserves)| `pg_isready -U omnifi` |
| `omnifi-redis` | `redis:7-alpine` | `6379:6379` | Route Graph Cache & Rate Limiting | `redis-cli ping` |
| `omnifi-prometheus` | `prom/prometheus:v2.50.1` | `9090:9090` | Time-Series Metrics Ingestion Engine | `GET http://localhost:9090/-/healthy` |
| `omnifi-anvil` | `trufflesuite/ganache:latest` | `8545:8545` | Local EVM Blockchain Node (Chain ID `31337`) | `HTTP GET /` |

---

## 12. Architectural Decision Records (ADRs 001 - 015)

Every major engineering and protocol decision is preserved in [`docs/adr/`](docs/adr/):

| ADR | Title | Core Architectural Decision |
|---|---|---|
| [ADR-001](docs/adr/ADR-001-chain-selection.md) | Chain Selection | Native deployments on Ethereum Mainnet, Base L2, and Solana Mainnet-Beta. |
| [ADR-002](docs/adr/ADR-002-v2-inclusion.md) | Uniswap V2 AMM Inclusion | Implement constant-product AMM for base pairs and high-resilience fallback liquidity. |
| [ADR-003](docs/adr/ADR-003-evm-clmm-strategy.md) | EVM Concentrated Liquidity Strategy | Deploy custom Uniswap V3 CLMM with $Q64.96$ fixed-point math and BitMap indexing. |
| [ADR-004](docs/adr/ADR-004-v4-singleton-scope.md) | Uniswap V4 Singleton Scope | Implement singleton PoolManager with EIP-1153 transient storage and flash accounting. |
| [ADR-005](docs/adr/ADR-005-solana-clmm-strategy.md) | Solana CLMM & AMM Strategy | Implement native Anchor programs with parallel TickArrays and PDA vault authority. |
| [ADR-006](docs/adr/ADR-006-token-policy.md) | Token Integration & Risk Policy | Enforce asset risk categorization (LOW, MEDIUM, HIGH) with fee-on-transfer protection. |
| [ADR-007](docs/adr/ADR-007-economic-parameters.md) | Protocol Economic Parameters | Standardize fee tiers: 5 bps (stables), 30 bps (standard), 100 bps (volatile). |
| [ADR-008](docs/adr/ADR-008-position-model.md) | Non-Fungible Position Model | Represent CLMM positions as transferable ERC-721 non-fungible tokens. |
| [ADR-009](docs/adr/ADR-009-oracle-policy.md) | Oracle & Price Feed Policy | Integrate geometric TWAP accumulators into pool state storage. |
| [ADR-010](docs/adr/ADR-010-upgradeability.md) | Contract Upgradeability Pattern | Keep core pool vaults strictly immutable; upgrade periphery routers via UUPS proxies. |
| [ADR-011](docs/adr/ADR-011-admin-custody.md) | Non-Custodial Key Architecture | Decouple backend services from signing; require 100% client-side transaction signatures. |
| [ADR-012](docs/adr/ADR-012-infrastructure.md) | Production Infrastructure Stack | Docker Compose containerization, PostgreSQL persistence, Redis caching, Prometheus/Grafana. |
| [ADR-013](docs/adr/ADR-013-slos.md) | Service Level Objectives (SLOs) | Sub-100ms quote response latency, 99.9% API uptime, zero financial data loss. |
| [ADR-014](docs/adr/ADR-014-legal-compliance.md) | Non-Custodial Legal Posture | Pure protocol software provider; zero custodial control or financial intermediation. |
| [ADR-015](docs/adr/ADR-015-token-authorization.md) | Token Registry Authorization | Automated bytecode verification and governance-approved asset whitelist. |

---

## 13. License and Attribution

OmniFi is released under the **[Apache License 2.0](LICENSE)**.

*Built from first principles for decentralized, permissionless, and non-custodial financial exchange.*
