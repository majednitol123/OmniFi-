# ADR-010: Upgradeability Policy

- Status: Accepted
- Date: 2026-11-01
- Owners: [Pending assignment]
- Related requirements: plan.md §4.1, §12

## Context

OmniFi must decide whether on-chain components (smart contracts on EVM, programs on Solana) are immutable after deployment or upgradeable. This decision has profound security, trust, and operational implications.

Immutability guarantees that the code users interact with cannot be changed — maximizing trust but preventing bug fixes. Upgradeability allows patching critical vulnerabilities but introduces a privileged admin role that can alter protocol behavior, creating a rug-pull vector if the upgrade authority is compromised.

The decision must be made independently for each chain and separately for each component type (core pool logic, periphery/router, position manager, factory).

### EVM upgrade mechanisms

Immutable (no proxy), transparent proxy, UUPS proxy, beacon proxy, and timelock-delayed upgrades are all available. Each trades flexibility for trust.

### Solana upgrade mechanisms

Freeze authority (immutable), retained upgrade authority (mutable), multisig upgrade authority, timelock delay, and programmatic governance authority (R1 excludes governance).

## Decision drivers

- **Trust model:** Users must understand who can change the code they interact with.
- **Bug severity response:** Critical vulnerabilities (e.g., fund drainage) require rapid response.
- **Rug-pull resistance:** Upgrade authority is the most powerful role in the protocol; its compromise is catastrophic.
- **Audit efficiency:** Immutable contracts have a fixed audit scope; upgradeable contracts require re-audit on every upgrade.
- **Component criticality:** Core pool contracts hold user funds; periphery contracts mediate access but do not hold funds.
- **Operational maturity:** R1 is early-stage; bugs are more likely than in a battle-tested protocol.
- **Industry precedent:** Uniswap v3 core is immutable; periphery (router, position manager) is replaceable. This is the most trusted model in DeFi.

## Options considered

### EVM options

#### Option A: All contracts immutable

**Description:** Deploy all contracts without proxy patterns. To fix bugs, deploy a new version and migrate users.

**Pros:**
- Maximum trust — "code is law."
- No admin key risk.
- Simplest security model.
- Strongest audit guarantee (audited code = deployed code forever).

**Cons:**
- Any critical bug in core contracts requires a new deployment + full migration.
- Migration is expensive, disruptive, and may lose TVL.
- Periphery bugs (router, position manager) also require migration.
- R1 code has not been battle-tested; immutability is premature.

#### Option B: Proxy pattern with timelock for all contracts

**Description:** All contracts use a proxy pattern (UUPS or transparent) with a timelock-protected upgrade authority (multisig + 48h delay).

**Pros:**
- Maximum flexibility to fix bugs.
- Timelock gives users exit time before upgrades take effect.

**Cons:**
- Core pool contracts holding user funds are upgradeable — a compromised admin can drain all pools.
- Even with timelock, sophisticated attackers can exploit the upgrade window.
- Users must actively monitor upgrade proposals.
- Trust model is "trust the admin," which is antithetical to DeFi.
- Every upgrade requires re-audit.

#### Option C: Core immutable + periphery upgradeable (Recommended)

**Description:** A layered approach based on component criticality:

| Component | Upgradeability | Rationale |
|---|---|---|
| Pool contracts (V2, CLMM) | **Immutable** | Hold user funds; must be maximally trusted |
| Factory / pool registry | **Immutable** | Pool creation logic must be fixed |
| PoolManager (v4-style) | **Immutable** | Singleton holding all pool state; must be immutable |
| Router | **Upgradeable** (UUPS + timelock) | Stateless; does not hold funds; bugs affect UX not funds |
| Position Manager | **Upgradeable** (UUPS + timelock) | Manages NFTs but does not hold pool liquidity |
| Quoter | **Upgradeable** (UUPS + timelock) | Read-only simulation; no fund risk |
| Periphery helpers | **Upgradeable** (UUPS + timelock) | Convenience wrappers; replaceable |

**Pros:**
- Core fund safety matches the Uniswap v3 trust model — the most proven approach in DeFi.
- Periphery upgradeability allows rapid bug fixes for UX-critical components.
- Timelock on periphery upgrades gives users transparency.
- Clear boundary: "code holding your funds never changes; code you interact through can be improved."

**Cons:**
- Core bugs require deploying new pool contracts and migrating liquidity.
- Slight operational complexity in maintaining both immutable and upgradeable components.
- Router upgrades, while lower risk, still require audit.

### Solana options

#### Option A: Freeze upgrade authority after audit

**Description:** Deploy programs and freeze the upgrade authority, making them permanently immutable.

**Pros:**
- Maximum trust — no one can change the program.
- Equivalent to EVM immutable contracts.

**Cons:**
- Solana programs are typically more complex than individual EVM contracts; bugs are more likely.
- The Solana ecosystem convention is to retain upgrade authority with a multisig.
- A critical bug with no upgrade path could mean permanent fund loss.
- Premature for R1 code that has not been battle-tested.

#### Option B: Retain upgrade authority with multisig + timelock (Recommended)

**Description:** The upgrade authority for all Solana programs is a multisig (e.g., Squads Protocol multisig) with a mandatory timelock. The program can be upgraded but only with N-of-M signatures and a waiting period.

| Parameter | Value |
|---|---|
| Upgrade authority | Squads N-of-M multisig (exact N, M TBD) |
| Timelock | 48 hours minimum |
| Emergency override | Separate emergency multisig with higher threshold (e.g., 4-of-7) for zero-delay upgrades in critical scenarios |

**Pros:**
- Retains ability to fix critical bugs — essential for R1.
- Multisig prevents single-key compromise from upgrading programs.
- Timelock gives users/LPs time to review upgrades and exit if desired.
- Consistent with Solana ecosystem best practices (most major Solana protocols retain upgrade authority).
- Emergency path available for genuine security incidents.

**Cons:**
- Trust assumption: users trust the multisig signers.
- Key management complexity for multisig members.
- Emergency multisig is a powerful capability that could be abused.
- Every upgrade requires coordination among signers.

#### Option C: Programmatic upgrade authority via governance

**Description:** Upgrade authority is controlled by an on-chain governance program.

**Pros:**
- Decentralized control over upgrades.
- Community-driven decision making.

**Cons:**
- R1 has no governance system (plan.md §2.2).
- Cannot be implemented in R1 timeline.
- Governance attacks could lead to malicious upgrades.

## Decision

**Recommended:**
- **EVM: Option C — Core immutable, periphery upgradeable with UUPS + timelock.**
- **Solana: Option B — Retain upgrade authority with multisig + timelock.**

### EVM implementation details

**Immutable (no proxy):** Pool contracts (V2 pair, CLMM pool), factory contracts, PoolManager (v4-style singleton).

**Upgradeable (UUPS + 48h timelock via multisig, recommended 3-of-5 min):** SwapRouter, PositionManager, Quoter, periphery helpers.

**Upgrade process:** Propose → announce with changelog/audit/diff → 48h wait → execute → verify bytecode + smoke tests.

### Solana implementation details

**All programs retain upgrade authority** (`omnifi_amm`, `omnifi_clmm`, `omnifi_router`, `omnifi_position_manager`).

**Upgrade authority:** Squads N-of-M multisig (recommended 3-of-5 min). **Timelock:** 48h minimum. **Emergency:** Separate higher-threshold multisig (e.g., 4-of-7) for zero-delay critical patches, with public justification and post-incident review.

**Upgrade process:** Reproducible build (Anchor verified) → propose via Squads → publish hash/diff/audit → 48h timelock → execute → verify program hash.

**Freeze plan:** After 6–12 months battle-testing with no critical upgrades, propose freezing upgrade authority via separate ADR, ideally coinciding with governance readiness (R2).

## Security implications

- **EVM core immutability** eliminates the most dangerous attack vector: admin-controlled pool logic changes.
- **EVM periphery upgradeability** introduces a weaker risk: a compromised router could manipulate swap routing, but it cannot directly drain pool funds.
- **Timelock** mitigates upgrade surprise: monitoring systems and users can detect proposals and react.
- **Solana multisig** is the strongest practical control for R1. It is weaker than immutability but appropriate for code that hasn't been battle-tested.
- **Emergency multisig** is a calculated trade-off: it enables rapid response to exploits but is itself a high-value target.
- **Key management** for both EVM multisig and Solana Squads is a critical operational security concern. Hardware wallets, geographic distribution, and rotation policies are required.

## Economic implications

- Immutable core contracts provide the strongest trust signal to LPs — "your funds are governed only by audited, fixed code."
- Upgradeable periphery allows fee-structure improvements, router optimizations, and UX enhancements without pool migration.
- The cost of a core contract migration (if a critical bug is found) is high: coordinated effort, gas costs, temporary liquidity fragmentation, and potential TVL loss.
- Solana upgrade authority retention allows the team to fix economic parameter bugs (e.g., fee calculation errors) without deploying entirely new programs.

## Operational implications

- **Monitoring:** Timelock proposals must trigger immediate alerts to the security team and be publicly visible (on-chain events + dashboard).
- **Runbook:** Documented procedures for proposing, announcing, waiting, executing, and verifying upgrades.
- **Key ceremony:** Initial multisig setup, key distribution, and rotation procedures must be documented and rehearsed.
- **Emergency playbook:** Defined criteria for when emergency (zero-delay) upgrade is justified. Post-incident report required.
- **Audit pipeline:** Every upgrade to a proxied contract requires a focused security review of the diff.
- **Reproducible builds:** Both EVM (Foundry) and Solana (Anchor) must produce deterministic build artifacts for verification.

## Alternatives rejected

- **EVM all immutable (Option A)** rejected because R1 periphery bugs are likely and migration-only fixes are too disruptive. Core immutability is adopted.
- **EVM all upgradeable (Option B)** rejected because upgradeable pool contracts create unacceptable rug-pull risk and undermine user trust.
- **Solana freeze after audit (Option A)** rejected because R1 code is not battle-tested and a critical bug without an upgrade path could cause permanent fund loss.
- **Solana governance-controlled upgrades (Option C)** rejected because R1 has no governance system.

## Migration / rollback plan

- **EVM core contracts:** If a critical bug is found, deploy patched contracts with a new factory. Create a migration UI/contract that allows LPs to withdraw from old pools and deposit into new ones. Old pools remain functional for withdrawals.
- **EVM periphery:** Roll back by upgrading the proxy to a previous implementation via timelock. Or deploy a new router and update the frontend to use it.
- **Solana:** Upgrade authority allows rollback by deploying the previous program version. Timelock ensures this is not done hastily.
- **Transition to immutability:** When the team and community agree that code is sufficiently battle-tested, freeze Solana upgrade authority and/or stop maintaining EVM proxy admin keys (renounce ownership). This transition should be its own ADR.

## Open questions

1. What is the exact multisig configuration (N-of-M) for EVM timelock admin and Solana upgrade authority?
2. Who are the initial multisig signers? What are the geographic and organizational distribution requirements?
3. Should the emergency multisig be a separate set of signers or a higher threshold of the same set?
4. What is the minimum battle-testing period before considering freezing Solana upgrade authority?
5. Should the timelock delay be 48 hours or longer (e.g., 72 hours)?
6. Should upgrade proposals require an accompanying audit report, or is a focused diff review sufficient for periphery changes?
7. What key rotation policy should be enforced for multisig signers?
