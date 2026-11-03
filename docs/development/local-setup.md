# OmniFi — Local Development Setup Guide

This guide describes how to set up, build, test, and run the OmniFi development environment from a clean clone.

---

## 1. Prerequisites

Ensure the following tools are installed on your machine:

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | `>=20.0.0` (v20 or v24 recommended) | JavaScript/TypeScript runtime |
| **pnpm** | `>=9.15.0` | Monorepo package manager |
| **Foundry** | Latest stable (`forge`, `cast`, `anvil`) | EVM contract compilation, testing, and local node |
| **Rust** | `>=1.80.0` (pinned to `1.89.0`) | Solana program development |
| **Anchor CLI** | `0.32.1` | Solana smart contract framework |
| **Docker & Docker Compose** | Latest | Local database (Postgres), cache (Redis), and node services |

---

## 2. Initial Setup

1. **Clone the repository:**
   ```bash
   git clone <repo-url>
   cd OmniFi
   ```

2. **Run setup:**
   ```bash
   make setup
   ```
   This will install workspace npm packages, Foundry dependencies (`forge-std`, `openzeppelin-contracts`), and verify the Rust toolchain.

3. **Configure local environment variables:**
   ```bash
   cp .env.example .env.local
   ```

---

## 3. Starting Local Infrastructure

Start local Anvil (EVM), PostgreSQL 16, and Redis 7:

```bash
make up
```

Verify services are healthy:
```bash
docker compose ps
```

---

## 4. Building the Project

Build all monorepo packages, EVM contracts, and Solana programs:

```bash
make build
```

This runs:
- `pnpm turbo run build` (TypeScript packages & apps)
- `cd chains/evm && forge build` (Solidity contracts)
- `cd chains/solana && anchor build` (Solana programs)

---

## 5. Running Tests

Run all unit and integration test suites:

```bash
make test-all
```

Or test specific subsystems:
- `make test` — TypeScript domain, config, and packages
- `make test-evm` — EVM Foundry tests (with trace logs)
- `make test-solana` — Solana Cargo unit tests

---

## 6. Formatting and Linting

Before opening a pull request, ensure your code complies with formatting and linting rules:

```bash
make fmt-check
make lint
```

To auto-format code:
```bash
make fmt
```

---

## 7. Build Artifact Hashing

For security and audit trails, compute cryptographic hashes of all compiled artifacts:

```bash
make hash-artifacts
```
This generates `build-manifest.sha256`.

