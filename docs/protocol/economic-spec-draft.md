# OmniFi — Economic Specification

**Version:** 1.0  
**Status:** Approved — In Accordance with ADR-007  
**Date:** 2026-11-02  
**Source:** plan.md §4 table (Economic specification), ADR-007

---

## 1. Fee Model

### 1.1 Fee Types

| Fee Type | Description | Recipient | Disclosure |
|----------|-------------|-----------|------------|
| **LP Fee** | Swap fee earned by liquidity providers | LPs (via fee growth) | Shown per-hop in route |
| **Protocol Fee** | Portion of LP fee directed to protocol | Protocol fee recipient (multisig) | Shown in fee breakdown |
| **Hook Fee** | Fee charged by pool hook (if v4 enabled) | Hook contract | Shown in fee breakdown |
| **Network Fee** | Gas (EVM) or compute/priority fee (Solana) | Network validators | Shown as estimated gas cost |

All fees must be visible to the user **before** transaction confirmation. No hidden fees.

### 1.2 Fee Tier Options (Proposed — subject to ADR-007)

| Tier | LP Fee Rate | Typical Use Case | Tick Spacing |
|------|-----------|-----------------|--------------|
| 0.01% | 1 bps | Stable pairs | TBD |
| 0.05% | 5 bps | Correlated pairs | TBD |
| 0.30% | 30 bps | Standard pairs | TBD |
| 1.00% | 100 bps | Exotic/volatile pairs | TBD |

Tick spacing per fee tier to be determined in ADR-007.

### 1.3 Protocol Fee

- Protocol fee is a configurable fraction of the LP fee (not an additional fee on the user)
- Range: 0% to a maximum cap (proposed: 25% of LP fee — subject to ADR-007)
- Initial setting: 0% (protocol fee off at launch) or a value decided by owner
- Changes require multisig + timelock (ADR-011)

## 2. Rounding Policy

### 2.1 General Principle

**Round against the party receiving tokens** in every calculation:

| Operation | Rounding Direction | Rationale |
|-----------|--------------------|-----------|
| Swap output calculation | Round down (user receives less) | Protects pool reserves |
| Fee calculation | Round up (pool/protocol receives more) | Prevents fee leakage |
| Liquidity → token amount | Round up (depositor provides more) | Protects existing LPs |
| Token amount → liquidity | Round down (depositor gets less liquidity) | Protects pool |
| Fee growth accumulation | Round down | Prevents fee over-counting |
| Protocol fee split | Round down (protocol receives less) | Favors LPs |

### 2.2 Integer Arithmetic

- All calculations use integer arithmetic — no floating-point
- Division truncates (rounds toward zero in Solidity; explicit in Rust)
- Rounding direction is achieved by adding (numerator - 1) before division where rounding up is needed
- Overflow checks are mandatory for all arithmetic

## 3. Dust Policy

| Rule | Threshold |
|------|-----------|
| Minimum swap input | TBD (must be > 0, may vary by token decimals) |
| Minimum liquidity deposit | TBD (must prevent pool manipulation) |
| Dust threshold for fee collection | TBD (below threshold, fees accumulate) |
| Minimum output enforcement | User-specified slippage tolerance; 0 is rejected |

## 4. Protocol Revenue Policy

- Protocol fee recipient address: controlled by multisig (ADR-011)
- Fee distribution: manual collection by protocol admin
- Revenue use: determined by project owner (no governance in R1)
- Fee changes: require multisig + timelock; must be transparent and announced

---

## Open Questions (Require Owner Decision)

1. Exact fee tier values and tick spacing?
2. Initial protocol fee percentage?
3. Minimum liquidity requirements per pool type?
4. Dust thresholds per token decimal class?

