---
id: "0152"
status: accepted
date: 2026-11-02
---

# Pi 1.5.0 audit edge and extension type view

## Context

Pi 1.5.0 validates tool arguments with `@earendil-works/pi-schema` instead of
TypeBox. The published `@earendil-works/pi-ai` package now types `StringEnum` as
a pi-schema `Schema`, and its model types derive from pi-schema. Inside Pi,
extensions instead import pi-ai through Pi's extension view, which keeps
TypeBox's `Type`, `Static`, and `TSchema` and a TypeBox-typed `StringEnum`.

SF Pi loaded and passed its complete suite on Pi 1.5.0, but type checking
against the published pi-ai typings reported 37 errors: enum-typed tool
parameters inferred as `unknown`, plus two narrow typing changes. Rewriting
tool schemas with pi-schema is not viable because Pi still types tool
definitions with TypeBox and does not expose pi-schema to extensions.

## Decision

Keep exact Pi 1.4.0 as the **Pi Runtime Floor** under ADR 0151 and advance the
**Pi Runtime Audit Edge** and recommended runtime to exact Pi 1.5.0. Pin the
coding-agent, AI, and TUI development dependencies together. The audited range
becomes `>=1.4.0 <1.5.1`; newer stable pre-2.0 releases remain loadable in
forward-compatibility mode under ADR 0079. Required compatibility lanes cover
exact Pi 1.4.0 and 1.5.0, with a non-blocking `latest` canary.

Type-check `@earendil-works/pi-ai` against the module extensions receive at run
time. `tsconfig.json` maps it to Pi's extension-view declaration, falling back
to the published entrypoint for runtimes that do not ship that view. Tool
schemas, runtime imports, and tool-argument JSON are unchanged.

This is a compatibility-only adoption. SF Pi adds no pi-schema dependency, tool
schema rewrite, wrapper, tool-exposure change, or new Salesforce behavior.

## Consequences

- Pi 1.5.0 is audited rather than producing a forward-compatibility warning.
- Pi 1.4.0 users retain support; the floor and Gateway compaction are unchanged.
- Type checking follows Pi's runtime extension contract rather than the
  published package typings. If a future Pi moves the extension view, the
  fallback restores the published typings and required CI reports the drift.
- Gateway model metadata names its thinking-level map shape locally because the
  pi-schema-derived type is not inferable without strict mode.

## Behavior Proofs

- Exact Pi 1.4.0 and 1.5.0 type checking and complete test suites on Node 22.
- Version-policy and Doctor proofs for the unchanged floor, new edge, exact pins,
  prereleases, future stable releases, and blocked major versions.
- Manifest Runtime Surface Attestation and clean-home offline SF Pi loading with
  no forward-compatibility warning on Pi 1.5.0.
- Pi-native MCP smoke, generated catalog, formatting, lint, documentation, and
  CI-like validation.
