# OmniFi — Development Troubleshooting Guide

This document captures common development hurdles, diagnostic steps, and fixes across the EVM, Solana, TypeScript, and Docker subsystems.

---

## 1. EVM / Foundry Issues

### Issue: Solc compiler version mismatch
**Symptom:** `Error: No compiler found for version 0.8.26`  
**Fix:** Ensure internet connectivity so Foundry can auto-download the required compiler via svm, or run:
```bash
svm install 0.8.26
svm use 0.8.26
```

### Issue: Forge formatting check fails
**Symptom:** `forge fmt --check` exits with code 1 and diff output.  
**Fix:** Run `cd chains/evm && forge fmt` to apply the canonical formatting configured in `chains/evm/foundry.toml`.

---

## 2. Solana / Anchor Issues

### Issue: Program ID mismatch on `anchor build`
**Symptom:**
```
Keypair file has: <KEY_A>
Source code has:  <KEY_B>
```
**Fix:** Run `cd chains/solana && anchor keys sync`. This synchronizes `Anchor.toml` and program source code with the generated build keypair.

### Issue: `unexpected_cfgs` warnings or errors
**Symptom:** Rust 1.80+ warns on macro-generated cfg attributes like `custom-heap`, `custom-panic`, or `anchor-debug`.  
**Fix:** `chains/solana/Cargo.toml` specifies `[workspace.lints.rust] unexpected_cfgs = { level = "allow" }`. Ensure any new crates inherit workspace lints with `[lints] workspace = true`.

---

## 3. TypeScript / Monorepo Issues

### Issue: Turbo cache collision or stale build artifacts
**Symptom:** Changes in `@omnifi/domain` are not reflected in dependent packages.  
**Fix:** Run a clean rebuild bypassing the cache:
```bash
pnpm turbo run build --force
```
Or execute `make clean && make setup && make build`.

### Issue: Missing workspace dependency resolution
**Symptom:** `Cannot find module '@omnifi/domain'`  
**Fix:** Ensure root `pnpm install` has been run so pnpm creates symlinks in `node_modules`.

---

## 4. Docker / Infrastructure Issues

### Issue: Port 5432 or 6379 already in use
**Symptom:** `docker compose up` fails with `port is already allocated`.  
**Fix:** Check running local processes:
```bash
lsof -i :5432
lsof -i :6379
```
Stop local Postgres or Redis daemons, or adjust ports in `docker-compose.yml` and `.env.local`.

