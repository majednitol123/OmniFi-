# ADR-013: Service Level Objectives

- Status: Accepted
- Date: 2026-11-01
- Owners: [DevOps/SRE, Product Owner]
- Related requirements: REQ-026

## Context

The plan (§33) requires protocol-facing, system-facing, and security-facing metrics. This ADR defines target SLOs for OmniFi services. Exact values require owner input — this ADR provides a tiered framework.

## Decision drivers

- DeFi user expectations — quotes must be fast, swaps must succeed
- Operational cost — tighter SLOs require more infrastructure investment
- Realism — initial launch will have lower traffic than mature protocol

## Decision

**Recommended: Tiered SLOs** — strict for critical path, relaxed for non-critical.

### Critical Path SLOs (Swap Execution)

| Service | Metric | Target |
|---------|--------|--------|
| Quote API | p95 latency | < 500ms |
| Quote API | Availability | 99.5% |
| Swap preparation API | p95 latency | < 1s |
| Swap preparation API | Availability | 99.5% |
| Frontend | Time to interactive | < 3s |

### Data Path SLOs (Indexing & Query)

| Service | Metric | Target |
|---------|--------|--------|
| EVM indexer | Lag behind chain head | < 30s (confirmed blocks) |
| Solana indexer | Lag behind slot | < 15s (confirmed slots) |
| Pool discovery API | p95 latency | < 200ms |
| Position query API | p95 latency | < 300ms |

### Operational SLOs

| Service | Metric | Target |
|---------|--------|--------|
| Reconciliation | Mismatch detection | < 5 min after event |
| Alerts | Critical alert notification | < 2 min |
| RPC health | Provider failover | < 10s |

## Security implications

- SLO monitoring must not expose sensitive data in metrics
- Alert thresholds for security events are separate from performance SLOs

## Operational implications

- SLOs require monitoring dashboards and alert rules
- SLO violations trigger incident response procedures
- Review and adjust SLOs quarterly based on actual performance data

## Open questions

- Are these targets acceptable for initial launch?
- Should SLOs be tighter for specific chains?

