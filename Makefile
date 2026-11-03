.PHONY: setup build test test-all test-evm test-solana lint fmt fmt-check up down clean hash-artifacts

# Default target
all: build test

# Environment setup
setup:
	pnpm install
	cd chains/evm && forge install
	cd chains/solana && cargo check

# Build all monorepo targets
build:
	pnpm turbo run build
	cd chains/evm && forge build
	cd chains/solana && anchor build

# Run unit tests
test:
	pnpm turbo run test

# Run EVM tests
test-evm:
	cd chains/evm && forge test -vvv

# Run Solana tests
test-solana:
	cd chains/solana && cargo test

# Run all test suites
test-all: test test-evm test-solana

# Linting
lint:
	pnpm turbo run lint
	cd chains/solana && cargo clippy -- -D warnings

# Code formatting
fmt:
	pnpm format
	cd chains/evm && forge fmt
	cd chains/solana && cargo fmt --all

# Check code formatting without writing
fmt-check:
	pnpm format:check
	cd chains/evm && forge fmt --check
	cd chains/solana && cargo fmt --all -- --check

# Docker development services
up:
	docker compose up -d

down:
	docker compose down

# Clean build artifacts
clean:
	pnpm turbo run clean
	cd chains/evm && forge clean
	cd chains/solana && cargo clean
	rm -rf build-manifest.sha256

# Hash build artifacts for audit
hash-artifacts:
	./scripts/hash-artifacts.sh

# Security tooling commands (Phase 3)
security-secrets:
	gitleaks detect --config .gitleaks.toml --verbose --no-git

security-evm:
	cd chains/evm && forge test
	cd chains/evm && aderyn .

security-slither:
	cd chains/evm && (slither . --config-file slither.config.json --json slither-report.json || test -s slither-report.json)

security-solana:
	cd chains/solana && cargo test
	cd chains/solana && cargo audit
	cd chains/solana && cargo deny check

security-deps:
	node scripts/security-audit-deps.mjs

security-infra:
	trivy fs --config trivy.yaml --scanners misconfig,secret .

security-invariants:
	cd chains/evm && forge test --match-test "invariant_" --evm-version cancun

security-regression:
	cd chains/evm && forge test --match-path test/security/SecurityRegression.t.sol --evm-version cancun

security-all: security-secrets security-deps security-evm security-slither security-solana security-infra security-invariants security-regression


