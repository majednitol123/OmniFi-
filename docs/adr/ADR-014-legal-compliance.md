# ADR-014: Legal and Compliance

- Status: Accepted
- Date: 2026-11-01
- Owners: [Project Owner]
- Related requirements: N/A (cross-cutting)

## Context

The plan (§4.1) lists "legal, compliance, and jurisdictional requirements" as an unresolved decision. This ADR documents the need for legal review — it does NOT constitute legal advice.

## Decision drivers

- Regulatory landscape for DeFi varies by jurisdiction
- Sanctions compliance is a baseline legal requirement
- KYC/AML requirements depend on product classification
- Frontend geo-restrictions are a common risk mitigation

## Options considered

### Option A: No restrictions — fully permissionless
**Cons:** Potential sanctions violations. Regulatory risk.

### Option B: Geo-blocking for sanctioned jurisdictions (Recommended)
**Pros:** Minimum viable compliance. Standard practice for DeFi frontends.
**Cons:** Frontend-only enforcement is not comprehensive.

### Option C: Full KYC/compliance framework
**Pros:** Maximum regulatory protection. **Cons:** High friction. Against DeFi ethos. Significant engineering.

## Decision

**Recommended: Option B** as a minimum baseline. Implement frontend geo-blocking for OFAC-sanctioned jurisdictions. Engage legal counsel before any production deployment to determine if additional compliance measures are required.

> [!CAUTION]
> This ADR is NOT a substitute for legal advice. The project owner MUST engage qualified legal counsel before production deployment.

## Open questions

- Has legal counsel been engaged?
- What jurisdictions are target markets?
- Are there token-specific regulatory requirements?

