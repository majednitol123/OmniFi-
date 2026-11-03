# Security Policy

The OmniFi Protocol adheres to institutional security best practices across all smart contract runtimes (EVM Cancun and Solana Anchor), off-chain routing engines, and backend microservices.

---

## 1. Reporting a Vulnerability

If you discover a security vulnerability or critical defect in OmniFi, please report it responsibly through our coordinated disclosure process.

**Do NOT open a public GitHub issue or discuss potential vulnerabilities publicly.**

### Reporting Process
1. **Email**: Send detailed vulnerability reports to `security@omnifi.xyz`.
2. **Encrypted Communication**: For sensitive vulnerability disclosures, please encrypt your submission using our official PGP key (fingerprint: `4A9F 82B1 C045 E772 90D3 18FA 5B22 D910 8C77 34E1`).
3. **Report Contents**:
   - A clear description of the vulnerability and its potential exploit scenario.
   - Proof-of-concept (PoC) code or reproducible steps (e.g. Foundry test or Anchor simulation).
   - An impact assessment (potential funds at risk, denial of service, data corruption).
   - Suggested remediation or patch, if known.

---

## 2. Response SLA & Coordinated Disclosure

- **Initial Response**: Within 24 hours of receipt.
- **Triage & Severity Assessment**: Within 48 hours.
- **Remediation & Patch Deployment**: Timelines depend on severity, following our 24-hour timelock and multisig governance process.
- **Coordinated Disclosure**: Public advisories are published after security patches are deployed and verified on-chain.

---

## 3. Scope

| Domain | In Scope | Out of Scope |
|---|---|---|
| **EVM Core Contracts** | `chains/evm/src/v2/`, `chains/evm/src/clmm/`, `chains/evm/src/v4-core/`, `chains/evm/src/periphery/` | Third-party protocols and external bridge contracts |
| **Solana Programs** | `chains/solana/programs/omnifi_amm/`, `chains/solana/programs/omnifi_clmm/` | Solana validator software or standard SPL token program |
| **Routing & SDKs** | `@omnifi/quote-engine`, `@omnifi/sdk-evm`, `@omnifi/sdk-solana`, `@omnifi/sdk-unified` | Third-party RPC endpoints |
| **API Services** | `services/quote-api` (SSRF, route manipulation, DoS) | Volumetric DDoS against public cloud CDNs |

---

## 4. Security Practices & Controls

- **Zero-Trust Key Management**: Backend services never custody user keys or sign transactions on users' behalf.
- **Formal Verification**: Mathematical invariants proven via Certora Prover and fuzz-tested via Echidna.
- **Multi-Signature Governance**: Administrative authorities governed by 2-of-4 Gnosis Safe (EVM) and Squads v4 (Solana) with 24-hour timelocks.
- **Automated DevSecOps**: Continuous static analysis (Slither, Aderyn), supply chain auditing (Cargo Audit, Cargo Deny, pnpm audit), and secret scanning (Gitleaks) enforced on every pull request.
