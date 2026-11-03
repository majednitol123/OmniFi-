# Contributing to OmniFi Protocol

Thank you for your interest in contributing to OmniFi. We welcome contributions from developers, security researchers, and DeFi protocol engineers.

---

## 1. Development Prerequisites

Before contributing code, ensure your local development environment has:
- **Node.js**: `v20.0.0` or higher (Node 22 recommended)
- **pnpm**: `v9.0.0` or higher (`npm install -g pnpm`)
- **Foundry**: Latest stable (`curl -L https://foundry.paradigm.xyz | bash && foundryup`)
- **Rust & Cargo**: `1.75+` with Solana toolchain (`curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`)
- **Anchor CLI**: `0.30.0` or higher
- **Docker & Docker Compose**: For running local persistence and telemetry containers

---

## 2. Local Environment Setup

```bash
# 1. Clone repository
git clone https://github.com/omnifi/omnifi.git
cd OmniFi

# 2. Install workspace dependencies
pnpm install

# 3. Compile smart contracts and programs
make build

# 4. Run test suites across EVM, Solana, and Monorepo
make test-all
```

---

## 3. Pull Request Process

1. **Branching**: Branch off `main` using descriptive naming:
   - `feat/feature-name`
   - `fix/bug-description`
   - `perf/optimization`
   - `sec/security-hardening`
2. **Atomic Commits**: Keep commits focused and logically grouped. Use imperative commit messages (`feat: add tick bitmap range search`).
3. **Test Coverage**: Every PR must include corresponding tests:
   - EVM changes: Foundry unit tests, invariant fuzz tests, and differential comparisons where applicable.
   - Solana changes: Anchor/Rust unit and property tests.
   - TypeScript/API changes: Vitest unit and integration tests.
4. **Formatting & Linting**:
   ```bash
   make fmt-check
   make lint
   ```
5. **Security Verification**:
   All PRs must pass the unified automated security pipeline prior to review:
   ```bash
   make security-all
   ```

---

## 4. Engineering Standards & Protocol Principles

1. **Zero Floating-Point Arithmetic**: All financial calculations, fee growth tracking, price impacts, and token amounts must use integer arithmetic or fixed-point ($Q64.96$) math. Floating-point types (`number` floats, `f64`) are strictly prohibited in protocol logic.
2. **Decoupled Key Architecture**: Backend microservices and routing APIs must never accept, hold, or proxy private keys. All signing must occur on the client side.
3. **Multi-Chain Isolation**: EVM and Solana codebases are independently engineered. Do not introduce cross-runtime leaky abstractions or synthetic bridging contracts.
4. **Reentrancy Protection**: All state-modifying external methods must enforce reentrancy guards or EIP-1153 transient storage locking.
5. **Fail-Closed Verification**: Scripts and CI checks must fail closed with exit code 1 upon any anomaly. Never swallow errors with `|| true`.
6. **Preserve Immutability**: Core pool vaults must remain immutable. Upgrades are restricted to periphery contracts via governance multi-signature quorums.

---

## 5. Security Vulnerability Reporting

If you discover a security vulnerability, do NOT open a public GitHub issue. Please consult [`SECURITY.md`](SECURITY.md) for our responsible disclosure policy and contact procedures.
