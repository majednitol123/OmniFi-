# OmniFi CI/CD Security Architecture & Pipeline Guide

## 1. Executive Summary

The OmniFi protocol and cross-chain routing platform enforces strict, defense-in-depth continuous integration and deployment (CI/CD) security gates. Every code push, pull request, and release candidate must pass through automated static analysis, container image auditing, secret detection, invariant fuzzing, and dependency provenance checks across Ethereum (EVM Cancun), Solana (Sealevel Anchor), and TypeScript microservices.

---

## 2. CI/CD Security Workflow Architecture

```
                                  [ Git Push / PR to main ]
                                              │
         ┌───────────────────┬────────────────┴──────────────────┬───────────────────┐
         │                   │                                   │                   │
         ▼                   ▼                                   ▼                   ▼
┌──────────────────┐┌──────────────────┐               ┌──────────────────┐┌──────────────────┐
│   security.yml   ││    ci-evm.yml    │               │  ci-solana.yml   ││ci-typescript.yml │
│                  ││                  │               │                  ││                  │
│ • Secret Scan    ││ • Forge Fmt      │               │ • Cargo Fmt      ││ • ESLint & Turbo │
│   (Gitleaks)     ││ • Forge Build    │               │ • Cargo Clippy   ││ • TS Typecheck   │
│ • Dep Audits     ││   (--sizes)      │               │   (-D warnings)  ││ • Vitest Suites  │
│   (cargo/pnpm)   ││ • Unit Tests     │               │ • Unit Tests     ││ • Docker E2E     │
│ • Slither SAST   ││ • Cancun Fuzzing │               │ • Anchor Tests   ││ • Quote API Test │
│ • Aderyn SAST    ││ • Invariant Runs │               └──────────────────┘└──────────────────┘
│ • Trivy Infra    ││ • Security Regr. │
│ • Security Gate  │└──────────────────┘
└────────┬─────────┘
         │
         ▼
[ Automated PR Block / Pass ]
```

---

## 3. Workflow Specifications

### 3.1 `security.yml` — Security Gates & Static Analysis

| Job Name | Tooling | Scope / Target | Blocking Policy |
| :--- | :--- | :--- | :--- |
| `secret-scan` | Gitleaks v8 | Repository commits & files vs `.gitleaks.toml` | **Blocking** (0 leaks permitted) |
| `dependency-audit` | `scripts/security-audit-deps.mjs`, Cargo Audit, Cargo Deny, pnpm audit | Rust crates & production Node dependencies | **Blocking** (0 critical backend vulns) |
| `solidity-static-analysis` | Slither 0.11.6, Aderyn 0.1.7, Foundry Cancun | `chains/evm/src/` contracts & periphery | **Blocking** (artifacts generated & verified) |
| `container-and-infra` | Trivy v0.60.0 | Dockerfiles, configs, and infra files | **Blocking** (0 root users, 0 unpinned images) |
| `security-gate` | GitHub Actions gate synthesizer | Aggregates all security job conclusions | **Blocking** (PR merge blocked on failure) |

### 3.2 `ci-evm.yml` — Smart Contract Verification (Cancun)

All EVM builds and tests are strictly pinned to the `cancun` EVM target to ensure transient storage (`TSTORE`/`TLOAD`) opcode safety:
- **Format Verification:** `forge fmt --check`
- **Bytecode Size Limits:** `forge build --sizes` (guarantees Spurious Dragon 24,576 byte contract limit)
- **Comprehensive Unit Testing:** Core v2 AMM, v3 CLMM, and v4 PoolManager (166+ tests)
- **Fuzzing & Invariant Testing:** `forge test --match-test "invariant_"` with stateful actors
- **Security Regression Suite:** `forge test --match-path test/security/SecurityRegression.t.sol`

### 3.3 `ci-solana.yml` — Sealevel Program Verification

All Solana programs in `chains/solana/` adhere to zero-warning compilation standards:
- **Format Verification:** `cargo fmt --check`
- **Strict Clippy Lints:** `cargo clippy --all-targets -- -D warnings`
- **Native Unit Tests:** AMM constant product math, CLMM tick arrays, math overflow bounds
- **Anchor Integration Tests:** Local validator integration tests via Node/TypeScript

### 3.4 `ci-typescript.yml` — Microservices & Database Integrity

TypeScript backend services (`quote-api`, `indexer-evm`, `indexer-solana`, `reconciliation-worker`):
- **Monorepo Lint & Typecheck:** `pnpm turbo run lint typecheck`
- **Unit & Integration Tests:** `pnpm turbo run test`
- **Live Infrastructure Integration:** Real PostgreSQL and Redis container validation

---

## 4. Secret Management & Environment Isolation

1. **No Sensitive Keys in Repository:**
   - Private keys, seed phrases, API credentials, and production RPC endpoints are strictly forbidden in git history.
   - Guarded locally and in CI via `.gitleaks.toml` with custom regex rules for EVM 32-byte hex keys and Solana base58 keys.
2. **Deterministic Mock/Dev Keys:**
   - Development signers (e.g. Foundry standard test accounts like `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`) are explicitly allowlisted in `.gitleaks.toml` for local unit tests only.
3. **Container Security:**
   - Production Dockerfiles (`services/quote-api/Dockerfile`) run with unprivileged user `USER node` (UID 1000).
   - Base images use pinned sha256 digests or official LTS Node alpine releases.

---

## 5. Local Developer Execution Matrix

Developers can reproduce all CI security checks locally using the unified `Makefile` or `pnpm` scripts:

```bash
# 1. Run all security gates in sequence
make security-all
# Or via pnpm:
pnpm security:all

# 2. Individual security targets:
make security-secrets      # Gitleaks secret scan
make security-deps         # Cargo audit/deny + pnpm production audit
make security-evm          # Forge test + Aderyn static analysis
make security-slither      # Slither static analysis
make security-solana       # Solana cargo test + audit + deny check
make security-infra        # Trivy container and filesystem scan
make security-invariants   # Foundry stateful invariant fuzzing
make security-regression   # EVM security regression test suite
```

---

## 6. Audit Findings & Residual Risk Traceability

All security findings flagged by automated tools or manual reviews are tracked in the versioned registers:
- **Audit Findings Register:** [`docs/security/audit-findings-register.md`](file:///Users/majedurrahman/coding/OmniFi/docs/security/audit-findings-register.md)
- **Residual Risk Register:** [`docs/security/residual-risk-register.md`](file:///Users/majedurrahman/coding/OmniFi/docs/security/residual-risk-register.md)
- **Audit Reports:** [`docs/security/audit-reports/`](file:///Users/majedurrahman/coding/OmniFi/docs/security/audit-reports/)

