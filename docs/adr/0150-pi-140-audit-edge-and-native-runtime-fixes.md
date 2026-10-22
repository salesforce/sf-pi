---
id: "0150"
status: accepted
date: 2026-10-22
supersedes: ["0149"]
---

# Pi 1.4.0 audit edge and native runtime fixes

## Context

Pi 1.4.0 fixes concurrent extension dialogs, queues codemode scripts for a free
worker, budgets compaction and branch-summary output against the model limit,
restores late-registered tools on resumed branches, and improves provider retry
and truncated-response recovery. It also fixes loading the public `pi-ai/models`
entrypoint and accepts BOM-prefixed native MCP configuration.

SF Pi already permits stable Pi `>=1.0.0 <2.0.0`, but its development pins,
required compatibility edge, and recommended runtime remained Pi 1.3.0.

## Decision

Keep Pi 1.0.0 as the **Pi Runtime Floor** and advance the **Pi Runtime Audit Edge**
and recommended runtime to exact Pi 1.4.0. Pin the coding-agent, AI, and TUI
development dependencies together. The audited range becomes `>=1.0.0 <1.4.1`;
newer stable pre-2.0 releases remain loadable in forward-compatibility mode under
ADR 0079. Required compatibility lanes cover exact Pi 1.0.0 and 1.4.0, with a
non-blocking `latest` canary. The Node.js floor remains 22.19.0.

This is a compatibility-only adoption. Pi owns generic dialog lifecycle,
codemode execution, default summarization, tool restoration, provider retries,
terminal behavior, and model catalogs. SF Pi adds no wrapper, tool-exposure
change, classifier integration, or new Salesforce behavior.

Existing Slack clarification gating, dedicated Gateway compaction, Gateway
transport handling, masked credential entry, and source-bound SF MCP parsing
remain unchanged. Upstream fixes do not prove these implementations redundant
across the retained support window. Any deletion or behavioral alignment requires
a separate focused change and Behavior Proof.

## Consequences

- Pi 1.4.0 is audited rather than producing a forward-compatibility warning.
- Pi 1.0.0 users retain support without a parallel implementation.
- Doctor repair advice targets exact Pi 1.4.0; future stable releases remain
  warnings rather than incompatibility errors.
- Native runtime fixes arrive without increasing SF Pi implementation complexity.
- Simplification candidates remain separate from this dependency audit.

## Behavior Proofs

- Exact Pi 1.0.0 and 1.4.0 type checking and complete test suites on Node 22.
- Version-policy and Doctor proofs for the unchanged floor, new edge, exact pins,
  prereleases, future stable releases, and blocked major versions.
- Manifest Runtime Surface Attestation and clean-home offline SF Pi loading.
- Pi-native MCP smoke and explicit bundled `sf-dark` theme loading.
- Generated catalog, formatting, lint, documentation, and CI-like validation.
