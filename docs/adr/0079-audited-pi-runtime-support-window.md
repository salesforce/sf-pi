---
id: "0079"
status: accepted
date: 2026-07-22
---

# ADR 0079: Pi Runtime Forward-Compatibility Policy

SF Pi distinguishes **loadable** Pi releases from **audited** Pi releases. Lack of an audit is not evidence of incompatibility, so a newly published stable Pi 1.x release must not preemptively disable every SF Pi extension.

ADR 0134 raises the hard loadable range to stable Pi `>=1.0.0 <2.0.0`. ADR 0138 keeps that floor and advances the **Pi Runtime Audit Edge** and recommended development runtime to exact Pi `1.0.3`. Runtimes below the floor, prereleases, and Pi 2.x or later remain blocked with bounded repair guidance. The required-CI audit range is `>=1.0.0 <1.0.4`.

When a stable runtime is inside the hard range but above the audit ceiling, SF Pi:

1. loads every extension normally;
2. emits one process-wide forward-compatibility warning instead of one warning per extension;
3. reports a Doctor warning, not an error;
4. does not recommend a downgrade without a concrete failure; and
5. allows Pi's native update surface to offer the release.

Package metadata follows the hard range (`>=1.0.0 <2.0.0`) so npm does not reject a newly published stable Pi 1.x release. Development dependencies remain pinned to the latest exact audited runtime. Required nightly compatibility covers exact Pi 1.0.0 and 1.0.3; a non-blocking `latest` canary reports future drift so maintainers can advance the audit ceiling after evidence arrives.

The Pi 1.0.0 floor and 1.0.3 edge audits establish compatibility for complete Providers, native tool execution and nested calls, built-in MCP ownership, canonical MCP tool identity, project MCP overrides, canonical session context, actionable extension boundaries, authentication, custom TUI behavior, compaction, and retry recovery. Exact-runtime type checking and full suites cover provider registration, provider-neutral Gateway dispatch, Docs/Slack auth-only providers, credential resolution, lifecycle teardown, shared masked input, actionable settlement quality gates, and Guardrail mediation of normalized MCP tool names.

The audit through Pi 1.0.3 provides no replacement **Secure Credential Prompt Proof** for SF Pi's shared fixed-mask provider UI. Gateway, SF Docs, and SF Slack therefore continue to use ADR 0087's shared component. Pi alone owns credential persistence and logout.

[ADR 0084](./0084-agent-settled-update-coordinator.md) keeps automatic Pi runtime mutation out of SF Pi's update coordinator. Pi runtime updates remain user-managed; SF Pi's responsibility is to avoid breaking compatible future stable releases after the update.
