# SF Pi

SF Pi is the bundled Salesforce-focused extension suite for pi. It gives agents
workflow-oriented tools, command surfaces, safety mediation, and compact evidence
for Salesforce development and operations.

This root glossary contains only language shared across multiple SF Pi Modules.
Extension-local terminology belongs with the owning extension's README,
`CONTEXT.md`, `AGENT_GUIDE.md`, types, or ADRs.

## Language

**Pi Runtime Floor**:
The minimum Pi Runtime version SF Pi intentionally supports. Releases below the
floor are incompatible rather than maintained through per-feature shims.
_Avoid_: soft minimum, best-effort old runtime

**Pi Runtime Audit Edge**:
The newest exact Pi Runtime release covered by required compatibility evidence
and used for normal development guidance.
_Avoid_: latest available release, hard maximum

**Pi Runtime Support Window**:
The audited releases from the inclusive **Pi Runtime Floor** through the
**Pi Runtime Audit Edge**. Newer stable `0.x` releases inside the hard loadable
range can run in forward-compatibility mode without becoming audited
implicitly.
_Avoid_: open-ended compatibility claim, nightly-only support

**Node Runtime Floor**:
The minimum Node.js version supported by package metadata, preinstall checks,
doctor diagnostics, and loaded extensions.
_Avoid_: local-only Node check

**Salesforce-First Interpretation**:
The posture that ambiguous development requests in Salesforce contexts are
interpreted through Salesforce concepts and owning SF Pi workflows first, while
explicit general engineering requests remain fully supported.
_Avoid_: Salesforce-only scope, forced Salesforce tooling for unrelated work

**Salesforce Change Authority**:
The current source governing a requested outcome: repository source for
repository changes, live org evidence for live-org changes, and an owning SF Pi
tool result when it already proves the required fact.
_Avoid_: org-always-authoritative, local-always-authoritative, duplicate lookup

**Behavior Proof**:
A test or verified workflow that exercises a capability through the same public
seam an agent or human uses.
_Avoid_: compile-only confidence, private helper assertion

**Behavior-Proof-First Development**:
The practice of establishing failing or characterization evidence before a
behavioral change when feasible, applying the smallest change, and finishing
with passing evidence through the same seam.
_Avoid_: test-after default, unexplained no-test change

**Behavior Proof Ladder**:
The ordered evidence used according to risk: pure behavior tests, exact-runtime
integration, full validation, scoped live proof where fixtures are insufficient,
and manual visual QA only for visible behavior.
_Avoid_: universal live test requirement, coverage-only confidence

**Human-Only Transcript Row**:
A status or evidence row visible to the human but excluded from later model
context. It supports awareness and auditability without steering the agent.
_Avoid_: custom message, hidden prompt, diagnostic injection

**Agent Workflow Visibility Contract**:
The rule that agent-chosen work and mutations remain visible tool calls,
automatic lifecycle work uses meaningful **Human-Only Transcript Rows**, and
only actionable findings become model-visible follow-ups.
_Avoid_: hidden mutation, transcript dump, status noise in model context

**Active-Branch Context Projection**:
The compaction-aware model-context view that follows the active session branch,
keeps immutable guidance only while live, and exposes only the newest value for
each mutable hidden context type.
_Avoid_: sibling-branch context, all-entry injection scan

**Salesforce Instruction Surface**:
SF Pi-owned model-visible context present before task execution: the
**Salesforce Engineering Constitution**, routing summary, active tool schemas and
guidance, and compact runtime context. External skills and user/project
instructions are measured separately.
_Avoid_: entire context window, provider payload, external skill catalog

**Salesforce Engineering Constitution**:
The compact bundled baseline for Salesforce-first interpretation, authority,
Behavior Proofs, safety, minimal change, evidence, and context discipline. User
guidance may extend but never replace it.
_Avoid_: CLI cookbook, replacement kernel, per-tool manual

**External Salesforce Skill Surface**:
The independently owned Salesforce skill names and descriptions loaded through
Pi. SF Pi measures this surface but does not treat it as bundled-extension
operating documentation.
_Avoid_: SF Pi guide, bundled extension manual

**Progressive SF Pi Documentation**:
The pattern where compact routing stays visible and extension-owned
`AGENT_GUIDE.md` files are loaded only when deeper ordering, recovery, or
troubleshooting is useful. Guide loading is model judgment, not ceremony.
_Avoid_: mandatory guide load, full README injection, extension-owned skill copy

**SF Pi Routing Summary**:
The small runtime statement that active SF Pi tools take priority over external
skills and raw CLI, plus disabled **Capability Owners** and their enablement
path. It does not repeat the full extension catalog.
_Avoid_: active tool dump, command inventory

**Managed Capability**:
A workflow area that needs one direct active owner for agent use, such as SOQL,
Salesforce documentation, Slack research, or Data 360 operations.
_Avoid_: tool namespace, arbitrary feature bucket

**Capability Owner**:
The active Pi-native extension or explicitly adopted alternative that directly
owns a **Managed Capability** in the current configuration.
_Avoid_: preferred tool, provider, extension status

**Salesforce Connection Module**:
The shared `lib/common/sf-conn` Module that resolves target orgs, creates
Salesforce Core connections, selects request API versions, performs bounded
requests, refreshes definite expired sessions, and caches connection state.
_Avoid_: per-extension connection helper, implicit API 50, retry on permission 403

**Instruction Surface Report**:
A content-safe advisory measurement of SF Pi instructions, active tool
definitions/guidance, and the external Salesforce skill surface. It informs
review without becoming a token-size gate or exposing content.
_Avoid_: prompt dump, billing claim, hidden telemetry

**Instruction Behavior Eval**:
An opt-in live-model regression report for representative routing, grounding,
proof-first, CLI-use, release-ordering, and evidence behavior. Deterministic
composition and lifecycle tests remain required.
_Avoid_: mandatory live CI, unit-test replacement

**Manifest Runtime Surface Attestation**:
The real-factory Behavior Proof that runtime commands, providers, lifecycle
events, and the supported availability union of tools match each extension
manifest bidirectionally.
_Avoid_: source-string registration proof, conditional-tool allowlist

**Agent-Settled Quality Gate**:
A post-agent check that runs only after Pi has no automatic retry, compaction
retry, or queued follow-up left.
_Avoid_: per-tool streaming lint, immediate background scan

**Last-Known Usable Status**:
The newest successful status snapshot still useful for human orientation when a
current refresh fails, provided it remains inside the owning identity boundary.
_Avoid_: stale truth, optimistic health

**Current Probe Status**:
The latest attempt to refresh status from its live or configured source. It can
fail independently of a **Last-Known Usable Status**.
_Avoid_: displayed fallback, source of truth

**Status Presentation Fallback**:
A presentation decision that calmly shows a **Last-Known Usable Status** while
preserving the failed **Current Probe Status** for diagnostics.
_Avoid_: store rewrite, hidden failure

**On-Demand Capability Availability**:
The state where an enabled capability can be invoked even though an optional
external runtime is idle or absent.
_Avoid_: runtime ready, setup failure

**Runtime Readiness Fault**:
An enabled capability state proving corrective action is required, such as
broken configuration, failed authentication, or incompatible runtime behavior.
Ordinary absence of an optional runtime is not a fault.
_Avoid_: every non-ready state, optional runtime absent

**Diagnostics Handoff**:
A temporary ownership transition where a lifecycle-specific extension takes
over diagnostics for its domain while an older shared diagnostics path yields.
_Avoid_: duplicate diagnostics, immediate removal without proof
