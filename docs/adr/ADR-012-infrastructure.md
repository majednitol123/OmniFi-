# ADR-012: Infrastructure Vendors

- Status: Accepted
- Date: 2026-11-01
- Owners: [DevOps/SRE]
- Related requirements: REQ-035

## Context

OmniFi requires RPC providers, hosting, monitoring, and indexing infrastructure. The plan (§32-34) requires multi-provider RPC resilience, observability, and secret management. Vendor selection must not be embedded in code — credentials are injected at runtime.

## Decision drivers

- Reliability — DeFi requires high availability for RPC and API
- Cost — infrastructure must be justified by load (§34)
- Control — self-hosted gives more control; managed services reduce ops burden
- Security — RPC credentials and infrastructure access are sensitive
- Vendor lock-in — avoid deep coupling to a single provider

## Options considered

### RPC Providers
- **(A)** Single provider → Single point of failure. Rejected.
- **(B)** Multi-provider with failover (Recommended) → Resilience without self-hosting complexity.
- **(C)** Self-hosted nodes + provider backup → Maximum control but high ops cost.

### Hosting
- **(A)** Cloud PaaS → Fast but limited control.
- **(B)** Cloud IaaS (Recommended) → Good balance of control and managed infrastructure.
- **(C)** Kubernetes on cloud → Only if justified by scale (§34).

### Monitoring
- **(A)** Hosted SaaS → Easy but potentially expensive at scale.
- **(B)** Self-hosted OpenTelemetry-compatible stack (Recommended) → Matches §9 baseline. Full control.
- **(C)** Cloud-native monitoring → Vendor-locked.

## Decision

**Recommended:** Multi-provider RPC (B) + Cloud IaaS (B) + Self-hosted monitoring (B).

Specific vendor names are intentionally omitted — selection requires evaluation against current pricing, features, and reliability. The architecture must support swapping vendors without code changes.

## Security implications

- RPC credentials stored in secret manager, never in source control
- Provider responses are not canonical — must verify against finality checks (§32)
- Infrastructure access follows least-privilege principle

## Operational implications

- RPC failover requires health-check configuration per provider
- Monitoring stack must support OpenTelemetry (§9 baseline)
- Start simple — add Kubernetes only when scale justifies it

## Open questions

- Specific RPC providers to evaluate?
- Cloud provider preference (AWS/GCP/other)?
- Budget constraints for infrastructure?

