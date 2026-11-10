---
id: "0155"
status: accepted
date: 2026-11-10
supersedes: ["0151", "0152"]
---

# Pi 1.5.1 floor and Pi 1.5.2 audit edge

## Context

Exact Pi 1.5.2 type checking, the complete suite, runtime-surface attestation,
clean-home loading, and the native MCP smoke passed without code changes; the
public extension API is additive from 1.5.0 through 1.5.2. Several Pi 1.5.x
capabilities overlap SF Pi code, but the Pi 1.4.0 floor prevents using them:

- Pi 1.5.1 renders terminal Mermaid with `lovely-mermaid` instead of
  `grok-mermaid`. SF Brain's Visual Response Audit still predicted rendering
  with the retired engine, so its prediction diverged for pie charts.
- Pi 1.5.0 shows an installed package's `CHANGELOG.md` after an update, and Pi
  already reports available package updates. SF Pi duplicated both with a
  generated `release-<version>` announcement and a synthesized update notice
  whose remote source no longer exists.
- Pi 1.5.1 lets `ctx.ui.custom()` report blocked program status for inline
  input, which the shared masked credential prompt does not report.
- Pi 1.5.1 adds `pi auth login` and `pi auth logout`; a non-interactive logout
  removes a stored provider credential without a prompt.

## Decision

Raise the **Pi Runtime Floor** to exact Pi 1.5.1 and the **Pi Runtime Audit
Edge** and recommended runtime to exact Pi 1.5.2. The hard loadable range is
stable `>=1.5.1 <2.0.0` and the audited range is `>=1.5.1 <1.5.3`. Development
dependencies pin the coding-agent, AI, and TUI packages to 1.5.2. Required
nightly lanes cover exact Pi 1.5.1 and 1.5.2 with the non-blocking `latest`
canary. ADR 0079's forward-compatibility behavior is unchanged, and the native
Gateway compaction decided in ADR 0151 carries forward. There is no
older-runtime path.

Adopt the overlapping capabilities natively:

- SF Brain analyzes Mermaid with `lovely-mermaid`, Pi's renderer, and allows
  `pie` for a few proportions of one whole.
- Pi owns package update notices and post-update changelogs. SF Pi deletes the
  synthesized update notice, the generated release announcement, and the
  orphaned changelog summarizer. Maintainer announcements remain and must
  declare `expiresAt`, `maxVersion`, or `evergreen`.
- The shared masked credential prompt reports `blocked: { kind: "auth" }` while
  it waits for input.
- SF Guardrail adds `pi-auth-credential-change`, which asks before a
  model-issued `pi auth login` or `pi auth logout`, through the same command
  unwrapping as `pi-auth-credential-output`.
- Type checking maps pi-ai only to Pi's extension view; every supported runtime
  ships it.

## Consequences

- Users must run Pi 1.5.1 or later; older runtimes skip SF Pi with Doctor repair
  guidance.
- An SF Pi update shows its release notes once, under Pi's Extension Updates.
  The welcome splash no longer repeats them, and `collapseChangelog` condenses
  long post-update notes.
- SF Pi's welcome row still reports the installed version; its update hint
  appears only when a cached manifest or feed reports a newer version.
- Visual Response Audit results and terminal rendering now agree on every
  diagram form, including pie charts.
- Agents need explicit approval to change stored Pi logins through the shell;
  interactive `/login` and `/logout` stay human-driven and ungated.

## Behavior Proofs

- Exact Pi 1.5.1 and 1.5.2 type checking and complete suites on Node 22.
- Version-policy and Doctor proofs for the new floor, audit edge, exact pins,
  prereleases, future stable releases, and blocked major versions.
- A pie fixture that `grok-mermaid` classified as unsupported and Pi 1.5.2
  renders.
- Guardrail confirmations for direct, wrapped, environment-prefixed, shell,
  `eval`, `npx`, and chained `pi auth login|logout`, plus allowed mentions.
- Masked-prompt blocked status, generator and announcement-orchestrator proofs
  that no release or update entry is produced, runtime-surface attestation,
  clean-home loading, and the native MCP smoke.
